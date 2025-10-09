from datetime import datetime, timedelta
from flask import request, jsonify, make_response, session, redirect
from scripts.auth import (hash_password, generate_session_token, store_session, 
                  get_session, delete_session, get_active_sessions_count,
                  save_login_history, get_login_history, is_logged_in)
from scripts.user_manager import save_user
from scripts.mongo_client import MongoDBClient

mongo_client = MongoDBClient()

def api_login():
    try:
        # Get JSON data from request
        from scripts.user_manager import load_users
        users = load_users()
        data = request.get_json()

        # 400                
        if not data:
            return jsonify({
                "success": False,
                "message": "No data provided"
            }), 400
        
        username = data.get('username').lower().strip() if data.get('username') else None
        password = data.get('password').strip() if data.get('password') else None
        
        # 400
        
        if not username or not password:
            return jsonify({
                "success": False,
                "message": "Nhập gì đó đi con chó :)"
            }), 400
        allowed_characters = set("abcdefghijklmnopqrstuvwxyz0123456789_-")
        if not all(c in allowed_characters for c in username):
            return jsonify({
                "success": False,
                "message": "Username chỉ được chứa chữ thường, số, gạch dưới và gạch ngang."
            }), 400
        
        # Check if user exists
        if username not in users:
            # Create new user account
            new_user_data = {
                "password_hash": hash_password(password),
                "email": data.get("email", f"{username}@example.com"),
                "role": "user",
                "room": username
            }
            users[username] = new_user_data
            
            # Save to MongoDB
            save_user(username, new_user_data)
            
            # Log account creation
            account_creation = {
                "username": username,
                "status": "created",
                "timestamp": datetime.now().isoformat(),
                "ip_address": request.remote_addr
            }
            save_login_history(account_creation)
        
        # Verify password
        password_hash = hash_password(password)
        if users[username]["password_hash"] != password_hash:
            # Log failed login attempt
            failed_login = {
                "username": username,
                "status": "failed",
                "reason": "invalid_password",
                "timestamp": datetime.now().isoformat(),
                "ip_address": request.remote_addr
            }
            save_login_history(failed_login)
            
            return jsonify({
                "success": False,
                "message": "Sai mật khẩu rồi nhé!"
            }), 401
        
        # Generate session token
        session_token = generate_session_token()
        
        # Save successful login info
        login_record = {
            "username": username,
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "ip_address": request.remote_addr,
            "session_token": session_token,
            "email": users[username]["email"],
            "role": users[username]["role"]
        }
        save_login_history(login_record)
        
        store_session(session_token, {
            'username': username,
            'email': users[username]["email"],
            'role': users[username]["role"]
        })
        
        # Set session cookies
        session.permanent = True
        session['user_id'] = username
        session['user_email'] = users[username]["email"]
        session['user_role'] = users[username]["role"]
        session['session_token'] = session_token
        session['login_time'] = datetime.now().isoformat()
        
        # Create response with additional cookie settings
        response_data = {
            "success": True,
            "message": "Login successful",
            "data": {
                "username": username,
                "email": users[username]["email"],
                "role": users[username]["role"],
                "session_token": session_token
            }
        }
        
        response = make_response(jsonify(response_data), 200)
        
        # Set additional secure cookies
        response.set_cookie('logged_in', 'true', 
                          max_age=timedelta(days=7), 
                          httponly=False,
                          secure=False,
                          samesite='Lax')
        
        return response
        
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

def api_logout():
    try:
        # Check if user is logged in via session
        if not is_logged_in():
            return jsonify({
                "success": False,
                "message": "Not logged in"
            }), 401
        
        # Get session info for logging
        username = session.get('user_id')
        session_token = session.get('session_token')
        
        # Log logout in MongoDB
        if session_token:
            logout_record = {
                "username": username,
                "session_token": session_token,
                "status": "logout",
                "timestamp": datetime.now().isoformat(),
                "ip_address": request.remote_addr
            }
            save_login_history(logout_record)
            
            # Delete session from MongoDB
            delete_session(session_token)
        
        # Clear server-side session
        session.clear()
        
        # Create response and clear ALL cookies
        response_data = {
            "success": True,
            "message": "Logout successful"
        }
        
        response = make_response(jsonify(response_data), 200)
        
        # Clear all login-related cookies
        response.set_cookie('logged_in', '', expires=0, path='/')
        response.set_cookie('user_info', '', expires=0, path='/')
        response.set_cookie('session', '', expires=0, path='/')
        
        return response
        
    except Exception as e:
        print(f"Logout error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

def api_verify():
    """Verify if a session token is valid"""
    try:
        data = request.get_json()
        session_token = data.get('session_token')
        
        if not session_token:
            return jsonify({
                "success": False,
                "message": "Session token required"
            }), 400
        
        # Check session in MongoDB
        session_data = get_session(session_token)
        
        if session_data:
            return jsonify({
                "success": True,
                "message": "Session valid",
                "data": {
                    "username": session_data.get('user_id'),
                    "email": session_data.get('user_email'),
                    "role": session_data.get('user_role'),
                    "login_time": session_data.get('login_time')
                }
            }), 200
        
        return jsonify({
            "success": False,
            "message": "Invalid or expired session"
        }), 401
        
    except Exception as e:
        print(f"Verify error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

def api_login_history():
    """Get login history (admin only)"""
    try:
        login_history = get_login_history()
        active_sessions_count = get_active_sessions_count()
        
        return jsonify({
            "success": True,
            "data": {
                "login_history": login_history,
                "active_sessions_count": active_sessions_count
            }
        }), 200
        
    except Exception as e:
        print(f"Login history error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

def api_check_session():
    """Check if user has valid session cookie"""
    if is_logged_in():
        return jsonify({
            "success": True,
            "message": "Valid session",
            "data": {
                "username": session.get('user_id'),
                "email": session.get('user_email'),
                "role": session.get('user_role'),
                "login_time": session.get('login_time')
            }
        }), 200
    else:
        return jsonify({
            "success": False,
            "message": "No valid session"
        }), 401

def api_get_current_room():
    """Get the current chat room of the logged-in user"""
    if not is_logged_in():
        return jsonify({
            "success": False,
            "message": "Not logged in"
        }), 401
    username = session.get('user_id')
    if username != 'dtanh':
        return jsonify({
            "success": True,
            "data": {
                "room": "dtanh"
            }
        }), 200
    from scripts.user_manager import load_users
    users = load_users()
    user_data = users.get(username)
    if not user_data:
        return jsonify({
            "success": False,
            "message": "User data not found"
        }), 404
    room = user_data.get('room', username)
    return jsonify({
        "success": True,
        "data": {
            "room": room
        }
    }), 200
    
def api_get_chat_rooms():
    """Get available chat rooms"""
    try:
        # Get all users from MongoDB
        all_users = mongo_client.user_collection.find({}, {'username': 1})
        user_ids = [user['username'] for user in all_users]
        
        return jsonify({
            "success": True,
            "data": {
                "rooms": user_ids
            }
        }), 200
    except Exception as e:
        print(f"Chat rooms error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500
        
def join_room(room):
    """Join a chat room (admin only)"""
    if not is_logged_in() or session.get('user_id') != 'dtanh':
        return "Not authorized", 403
    username = session.get('user_id')
    user_data = mongo_client.user_collection.find_one({'username': username})
    if not user_data:
        return "User data not found", 404
    # Update user's room in MongoDB
    mongo_client.user_collection.update_one(
        {'username': username},
        {'$set': {'room': room}}
    )
    session['user_room'] = room
    return redirect('/')

def register_api_routes(app):
    """Register all API routes with the Flask app"""
    from scripts.auth import require_login_api, is_me_api
    # Load users for the login route
    
    # Register routes
    app.add_url_rule('/api/login', 'api_login', api_login, methods=['POST'])
    app.add_url_rule('/api/logout', 'api_logout', require_login_api()(api_logout), methods=['POST'])
    app.add_url_rule('/api/verify', 'api_verify', api_verify, methods=['GET'])
    app.add_url_rule('/api/login-history', 'api_login_history', is_me_api()(api_login_history), methods=['GET'])
    app.add_url_rule('/api/check-session', 'api_check_session', api_check_session, methods=['GET'])
    app.add_url_rule('/api/get-current-room', 'api_get_current_room', require_login_api()(api_get_current_room), methods=['GET'])
    app.add_url_rule('/api/get-chat-rooms', 'api_get_chat_rooms', is_me_api()(api_get_chat_rooms), methods=['GET'])
    app.add_url_rule('/api/join-room/<room>', 'api_join_room', is_me_api()(lambda room: join_room(room)), methods=['POST'])