import sqlite3
from pathlib import Path
from getpass import getpass
from passlib.context import CryptContext

db = Path(__file__).resolve().parent / "supportdesk.db"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

email = input("Email: ").strip().lower()
password = getpass("Password: ")

with sqlite3.connect(db) as conn:
    row = conn.execute(
        "SELECT password_hash FROM users WHERE lower(email)=?",
        (email,),
    ).fetchone()

if row is None:
    print("Account not found in this database.")
else:
    try:
        print("Password matches:", pwd_context.verify(password, row[0]))
    except Exception as exc:
        print("Hash verification error:", type(exc).__name__, str(exc))