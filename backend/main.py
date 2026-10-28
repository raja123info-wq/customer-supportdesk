import os
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

from ai_service import analyze_ticket

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
DB_PATH = Path(os.getenv("SUPPORTDESK_DB_PATH", str(BASE_DIR / "supportdesk.db")))
SECRET_KEY = os.getenv("SUPPORTDESK_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("Set SUPPORTDESK_SECRET_KEY in backend/.env before starting the API.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

app = FastAPI(title="Customer SupportDesk API", description="Support ticket management with ticket classification", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def get_password_column(connection) -> str:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
    for candidate in ("password_hash", "hashed_password"):
        if candidate in columns:
            return candidate
    raise RuntimeError("Users table has no supported password-hash column.")


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(get_connection()) as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL DEFAULT '',
                customer_email TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'Other',
                priority TEXT NOT NULL DEFAULT 'Medium',
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Open',
                user_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE TABLE IF NOT EXISTS ticket_ai_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                recommended_priority TEXT NOT NULL,
                confidence REAL NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        # Add fields to older ticket tables without removing existing data.
        ticket_columns = {row["name"] for row in connection.execute("PRAGMA table_info(tickets)").fetchall()}
        additions = {
            "title": "TEXT NOT NULL DEFAULT ''",
            "description": "TEXT NOT NULL DEFAULT ''",
            "updated_at": "TEXT",
            "user_id": "INTEGER",
        }
        for name, definition in additions.items():
            if name not in ticket_columns:
                connection.execute(f"ALTER TABLE tickets ADD COLUMN {name} {definition}")
        connection.execute("UPDATE tickets SET title = category WHERE title = '' OR title IS NULL")
        connection.execute("UPDATE tickets SET description = message WHERE description = '' OR description IS NULL")
        connection.execute("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at = ''")
        connection.commit()


@app.on_event("startup")
def startup():
    init_db()


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=72)


class TicketCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    customer_name: str = Field(min_length=2, max_length=100)
    customer_email: EmailStr
    description: str = Field(min_length=3, max_length=10000)
    priority: str = Field(default="Medium", max_length=20)
    category: str = Field(default="Other", max_length=100)


class TicketUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    customer_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    customer_email: Optional[EmailStr] = None
    category: Optional[str] = Field(default=None, max_length=100)
    priority: Optional[str] = Field(default=None, max_length=20)
    description: Optional[str] = Field(default=None, min_length=3, max_length=10000)
    status: Optional[str] = Field(default=None, max_length=30)


class TicketAnalysisRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=3, max_length=10000)


def validate_password(password: str):
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must not exceed 72 UTF-8 bytes.")


def create_access_token(user_id: int):
    expiry = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expiry}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)):
    unauthorized = HTTPException(status_code=401, detail="Invalid or expired authentication token", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, ValueError, TypeError, KeyError):
        raise unauthorized
    with closing(get_connection()) as connection:
        user = connection.execute("SELECT id, full_name, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        raise unauthorized
    return dict(user)


def validate_choice(value: str, allowed: set[str], field_name: str):
    if value not in allowed:
        raise HTTPException(status_code=422, detail=f"Invalid {field_name}. Allowed values: {', '.join(sorted(allowed))}")


def owned_ticket(connection, ticket_id: int, user_id: int):
    row = connection.execute("SELECT * FROM tickets WHERE id = ? AND user_id = ?", (ticket_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return row


@app.get("/")
def home():
    return {"application": "Customer SupportDesk API", "status": "online", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterRequest):
    validate_password(payload.password)
    email = str(payload.email).strip().lower()
    full_name = payload.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Full name must contain at least 2 characters.")
    hashed = pwd_context.hash(payload.password)
    try:
        with closing(get_connection()) as connection:
            password_column = get_password_column(connection)
            connection.execute(f"INSERT INTO users (full_name, email, {password_column}) VALUES (?, ?, ?)", (full_name, email, hashed))
            connection.commit()
            user_id = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    return {"id": user_id, "full_name": full_name, "email": email, "message": "Account created successfully"}


@app.post("/api/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    validate_password(form_data.password)
    email = form_data.username.strip().lower()
    with closing(get_connection()) as connection:
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        password_column = get_password_column(connection)
    if user is None:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    try:
        valid = pwd_context.verify(form_data.password, user[password_column])
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": create_access_token(user["id"]), "token_type": "bearer", "user": {"id": user["id"], "full_name": user["full_name"], "email": user["email"]}}


@app.get("/api/auth/me")
def get_my_account(current_user: dict = Depends(get_current_user)):
    return current_user


@app.get("/api/tickets")
def get_tickets(current_user: dict = Depends(get_current_user)):
    with closing(get_connection()) as connection:
        rows = connection.execute("SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC, id DESC", (current_user["id"],)).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/tickets/{ticket_id}")
def get_ticket(ticket_id: int, current_user: dict = Depends(get_current_user)):
    with closing(get_connection()) as connection:
        return dict(owned_ticket(connection, ticket_id, current_user["id"]))


@app.post("/api/tickets", status_code=201)
def create_ticket(payload: TicketCreate, current_user: dict = Depends(get_current_user)):
    validate_choice(payload.priority, {"Low", "Medium", "High", "Urgent"}, "priority")
    title, description = payload.title.strip(), payload.description.strip()
    customer_name, customer_email = payload.customer_name.strip(), str(payload.customer_email).strip().lower()
    if len(title) < 3 or len(description) < 3 or len(customer_name) < 2:
        raise HTTPException(status_code=422, detail="Please complete all required ticket fields.")
    with closing(get_connection()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO tickets (
                title, description, customer_name, customer_email,
                category, priority, message, status, user_id,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                title,
                description,
                customer_name,
                customer_email,
                payload.category.strip() or "Other",
                payload.priority,
                description,
                current_user["id"],
            ),
        )
        connection.commit()
        row = connection.execute("SELECT * FROM tickets WHERE id = ? AND user_id = ?", (cursor.lastrowid, current_user["id"])).fetchone()
    return dict(row)


@app.patch("/api/tickets/{ticket_id}")
def update_ticket(ticket_id: int, payload: TicketUpdate, current_user: dict = Depends(get_current_user)):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update")
    allowed_fields = {"title", "description", "customer_name", "customer_email", "category", "priority", "status"}
    if not set(updates).issubset(allowed_fields):
        raise HTTPException(status_code=400, detail="Unsupported update field")
    if updates.get("priority") is not None:
        validate_choice(updates["priority"], {"Low", "Medium", "High", "Urgent"}, "priority")
    if updates.get("status") is not None:
        validate_choice(updates["status"], {"Open", "In Progress", "Resolved", "Closed"}, "status")
    if "customer_email" in updates and updates["customer_email"] is not None:
        updates["customer_email"] = str(updates["customer_email"]).lower().strip()
    for key, value in updates.items():
        if isinstance(value, str):
            updates[key] = value.strip()
    if "description" in updates:
        updates["message"] = updates["description"]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    set_clause = ", ".join(f"{column} = ?" for column in updates)
    values = list(updates.values()) + [ticket_id, current_user["id"]]
    with closing(get_connection()) as connection:
        owned_ticket(connection, ticket_id, current_user["id"])
        connection.execute(f"UPDATE tickets SET {set_clause} WHERE id = ? AND user_id = ?", values)
        connection.commit()
        row = owned_ticket(connection, ticket_id, current_user["id"])
    return dict(row)


@app.delete("/api/tickets/{ticket_id}")
def delete_ticket(ticket_id: int, current_user: dict = Depends(get_current_user)):
    with closing(get_connection()) as connection:
        owned_ticket(connection, ticket_id, current_user["id"])
        connection.execute("DELETE FROM tickets WHERE id = ? AND user_id = ?", (ticket_id, current_user["id"]))
        connection.commit()
    return {"message": "Ticket deleted successfully", "id": ticket_id}


@app.get("/api/dashboard/stats")
def dashboard_stats(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    with closing(get_connection()) as connection:
        total = connection.execute("SELECT COUNT(*) FROM tickets WHERE user_id = ?", (uid,)).fetchone()[0]
        open_count = connection.execute("SELECT COUNT(*) FROM tickets WHERE user_id = ? AND status = 'Open'", (uid,)).fetchone()[0]
        in_progress = connection.execute("SELECT COUNT(*) FROM tickets WHERE user_id = ? AND status = 'In Progress'", (uid,)).fetchone()[0]
        resolved = connection.execute("SELECT COUNT(*) FROM tickets WHERE user_id = ? AND status IN ('Resolved', 'Closed')", (uid,)).fetchone()[0]
        high_priority = connection.execute("SELECT COUNT(*) FROM tickets WHERE user_id = ? AND priority IN ('High', 'Urgent') AND status NOT IN ('Resolved', 'Closed')", (uid,)).fetchone()[0]
    return {"total_tickets": total, "open_tickets": open_count, "in_progress_tickets": in_progress, "resolved_tickets": resolved, "high_priority_tickets": high_priority}


@app.post("/api/ai/analyze-ticket")
def analyze_ticket_endpoint(payload: TicketAnalysisRequest, current_user: dict = Depends(get_current_user)):
    try:
        result = analyze_ticket(payload.title.strip(), payload.description.strip())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    with closing(get_connection()) as connection:
        cursor = connection.execute("""INSERT INTO ticket_ai_analyses (user_id, title, description, category, recommended_priority, confidence, model)
            VALUES (?, ?, ?, ?, ?, ?, ?)""", (current_user["id"], payload.title.strip(), payload.description.strip(), result["category"], result["recommended_priority"], result["confidence"], result["model"]))
        connection.commit()
    return {"analysis_id": cursor.lastrowid, **result}


@app.get("/api/ai/analyses")
def get_ai_analyses(current_user: dict = Depends(get_current_user)):
    with closing(get_connection()) as connection:
        rows = connection.execute("SELECT * FROM ticket_ai_analyses WHERE user_id = ? ORDER BY created_at DESC, id DESC", (current_user["id"],)).fetchall()
    return [dict(row) for row in rows]
