
import sqlite3
from getpass import getpass
from pathlib import Path
from passlib.context import CryptContext

DB_PATH = Path(__file__).resolve().parent / "supportdesk.db"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

email = input("Account email: ").strip().lower()
password = getpass("Enter a new password (minimum 8 characters): ")

if len(password) < 8:
    raise SystemExit("Password must be at least 8 characters.")

if len(password.encode("utf-8")) > 72:
    raise SystemExit("Password must not exceed 72 bytes.")

# Test hashing before changing the database.
password_hash = pwd_context.hash(password)

with sqlite3.connect(DB_PATH) as connection:
    cursor = connection.execute(
        "UPDATE users SET password_hash = ? WHERE email = ?",
        (password_hash, email),
    )

    if cursor.rowcount == 0:
        raise SystemExit("Account not found. No password was changed.")

print("Password reset successfully. You can now log in.")
