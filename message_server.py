import os
import json
from datetime import datetime

DATA_DIR = "data"
MESSAGE_DIR = os.path.join(DATA_DIR, "messages")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")

def ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

def load_json_file(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json_file(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False


# Local Session Management
def store_session_local(session_token, user_data):
    ensure_data_dir()
    sessions = load_json_file(SESSIONS_FILE, {})
    session_data = {
        'user_id': user_data.get('username'),
        'user_email': user_data.get('email'),
        'user_role': user_data.get('role', 'user'),
        'login_time': datetime.now().isoformat(),
        'created_at': datetime.now().isoformat()
    }
    sessions[session_token] = session_data
    save_json_file(SESSIONS_FILE, sessions)
    return True

def get_session_local(session_token):
    ensure_data_dir()
    sessions = load_json_file(SESSIONS_FILE, {})
    return sessions.get(session_token)

def delete_session_local(session_token):
    ensure_data_dir()
    sessions = load_json_file(SESSIONS_FILE, {})
    if session_token in sessions:
        del sessions[session_token]
        save_json_file(SESSIONS_FILE, sessions)
        return True
    return False

def get_active_sessions_count_local():
    ensure_data_dir()
    sessions = load_json_file(SESSIONS_FILE, {})
    return len(sessions)


# Local Message Caching
def cache_message_local(message_data, user_id=None):
    if user_id is None:
        raise ValueError("user_id must be provided to cache messages locally")
    ensure_data_dir()
    messages = load_json_file(MESSAGE_DIR + "/" + user_id + ".json", [])
    messages.append(message_data)  # newest first
    save_json_file(MESSAGE_DIR + "/" + user_id + ".json", messages)
    return True

def get_recent_messages_local(user_id=None):
    if user_id is None:
        raise ValueError("user_id must be provided to get messages locally")
    ensure_data_dir()
    messages = load_json_file(MESSAGE_DIR + "/" + user_id + ".json", [])
    return list(messages)  # oldest first