import os, json, hashlib, secrets

# Create data directory if it doesn't exist
DATA_DIR = "data"
LOGIN_FILE = os.path.join(DATA_DIR, "login.json")
_MAX_LOGIN_HISTORY = 40

if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def generate_session_token():
    """Generate a secure session token"""
    return secrets.token_hex(32)

def save_login_info(login_data):
    """Save login information to /data/login.json"""
    try:
        # Load existing data
        if os.path.exists(LOGIN_FILE):
            with open(LOGIN_FILE, 'r') as f:
                data = json.load(f)
        else:
            data = {"login_history": [], "active_sessions": {}}
        
        # Add new login to history
        data["login_history"].append(login_data)
        
        # Keep only last 100 login records
        if len(data["login_history"]) > _MAX_LOGIN_HISTORY:
            data["login_history"] = data["login_history"][-_MAX_LOGIN_HISTORY:]
        
        # Save updated data
        with open(LOGIN_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        
        return True
    except Exception as e:
        print(f"Error saving login info: {e}")
        return False

def get_login_data():
    """Get login data from file"""
    try:
        if os.path.exists(LOGIN_FILE):
            with open(LOGIN_FILE, 'r') as f:
                return json.load(f)
        return {"login_history": [], "active_sessions": {}}
    except Exception as e:
        print(f"Error reading login data: {e}")
        return {"login_history": [], "active_sessions": {}}

def update_active_sessions(session_token, user_info):
    """Update active sessions in the JSON file"""
    try:
        data = get_login_data()
        data["active_sessions"][session_token] = user_info
        
        with open(LOGIN_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error updating active sessions: {e}")
        return False
