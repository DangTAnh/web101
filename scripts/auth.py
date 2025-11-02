import hashlib
import secrets
from datetime import datetime, timezone
from flask import request, jsonify, make_response, session
from scripts.mongo_client import MongoDBClient

mongo_client = MongoDBClient()

def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def generate_session_token():
    """Generate a secure session token"""
    return secrets.token_hex(32)

def store_session(session_token, user_data):
    mongo_client.insert_session({
        'session_token': session_token,
        'user_id': user_data.get('username'),
        'user_email': user_data.get('email'),
        'user_role': user_data.get('role', 'user'),
        'login_time': datetime.now(timezone.utc).isoformat(),
        'created_at': datetime.now(timezone.utc).isoformat()
    })
    return True

def get_session(session_token):
    return mongo_client.find_session({'session_token': session_token})

def delete_session(session_token):
    return mongo_client.delete_session({'session_token': session_token}) > 0

def get_active_sessions_count():
    return mongo_client.count_sessions({})

def save_login_history(login_data):
    return mongo_client.insert_login_history(login_data)

def get_login_history(limit=100):
    return mongo_client.get_login_history(limit)

def get_login_history_by_user(user_id, limit=100):
    return mongo_client.get_login_history_by_user(user_id, limit)

def update_active_sessions(session_token, user_info):
    return mongo_client.update_session({'session_token': session_token}, user_info)

def is_logged_in():
    """Check if user is logged in via session cookie"""
    return 'user_id' in session and 'session_token' in session

def require_login(f):
    """Decorator to require login for protected routes"""
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            from flask_socketio import emit
            emit('error', {'message': 'Login required'})
            return
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

def require_login_api():
    """Decorator factory for API routes that need to return JSON responses"""
    def decorator(f):
        def wrapper(*args, **kwargs):
            if not is_logged_in():
                return jsonify({
                    "success": False,
                    "message": "Login required"
                }), 401
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator

def is_me(f):
    """Decorator to require specific user (dtanh) for protected routes"""
    def wrapper(*args, **kwargs):
        if not is_logged_in() or session.get('user_id') != "dtanh":
            from flask_socketio import emit
            emit('error', {'message': 'Not authorized'})
            return
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

def is_me_api():
    """Decorator factory for API routes that need specific user authorization"""
    def decorator(f):
        def wrapper(*args, **kwargs):
            if not is_logged_in() or session.get('user_id') != "dtanh":
                return jsonify({
                    "success": False,
                    "message": "Not authorized"
                }), 403
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator

def require_dtanh(f):
    """Decorator for Flask routes that require user to be 'dtanh', returns 403 if not"""
    def wrapper(*args, **kwargs):
        if not is_logged_in() or session.get('user_id') != "dtanh":
            from flask import abort
            abort(403)  # Return 403 Forbidden
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper