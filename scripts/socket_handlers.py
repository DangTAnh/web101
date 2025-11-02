import secrets
from datetime import datetime
from flask import session
from flask_socketio import emit, join_room, leave_room
from scripts.auth import require_login, is_logged_in
from scripts.message_handler import (cache_message, get_recent_messages, get_messages_before, 
                           get_room, sanitize_for_json)

_ME = "dtanh"

def handle_connect(request, socketio):
    """Handle client connection"""
    try:
        user_id = session.get('user_id')
        room_id = get_room(user_id)
        join_room(room_id)
        emit('status', {
            'type': 'connected',
            'message': 'Connected',
            'data': {'room': room_id}
        })
    except Exception as e:
        emit('error', {'message': 'Failed to join room'})

def handle_disconnect(request):
    """Handle client disconnection"""
    try:
        user_id = session.get('user_id')
        room_id = get_room(user_id)
        leave_room(room_id)
    except Exception as e:
        emit('error', {'message': 'Failed to leave room'})

def handle_send_message(data, socketio):
    """Handle real-time message sending via Socket.IO"""
    try:
        # Validate message data
        if not data or not data.get('message'):
            emit('error', {'message': 'Message content required'})
            return
        message_text = data.get('message', '').strip()
        if len(message_text) > 1000:
            emit('error', {'message': 'Message too long (>1000 characters) this will not be sent'})
            return
        if not message_text:
            emit('error', {'message': 'Message cannot be empty'})
            return
        
        username = data.get('username', 'Unknown')
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Create message object
        message_data = {
            "id": secrets.token_hex(8),
            "username": username,
            "message": message_text
        }
        
        # Cache message
        room = get_room(session.get('user_id'))
        cache_message(message_data, room)
        
        # Broadcast message to all clients in the room
        socketio.emit('new_message', sanitize_for_json(message_data), room=room)
        
        if username != _ME:
            message_data_me = {
                "id": secrets.token_hex(8),
                "username": username,
                "message": f"<{username}>: {message_text}"
            }
            cache_message(message_data_me, _ME)
            socketio.emit('new_message', sanitize_for_json(message_data_me), room=_ME)
        
        # Send confirmation to sender
        emit('message_sent', {
            'success': True,
            'message_id': message_data['id'],
            'timestamp': timestamp
        })
    except Exception as e:
        print(f"Socket.IO message error: {e}")
        emit('error', {'message': 'Failed to send message'})

def handle_get_older_messages(data):
    """Load older messages"""
    try:
        before_message_id = data.get('before_message_id')
        if not before_message_id:
            emit('error', {'message': 'before_message_id required'})
            return
        
        room = get_room(session.get('user_id'))
        older_messages = get_messages_before(room, before_message_id, 10)
        
        emit('older_messages', {
            'messages': sanitize_for_json(older_messages),
            'count': len(older_messages)
        })
    
    except Exception as e:
        print(f"Socket.IO load older messages error: {e}")
        emit('error', {'message': 'Failed to load older messages'})

def handle_get_recent_messages():
    """Get recent messages"""
    try:
        room = get_room(session.get('user_id'))
        recent_messages = get_recent_messages(room, 30)
        emit('recent_messages', {
            'messages': sanitize_for_json(recent_messages),
            'count': 30 if len(recent_messages) > 30 else len(recent_messages)
        })
    
    except Exception as e:
        print(f"Error getting recent messages: {e}")
        emit('error', {'message': 'Failed to get recent messages'})

def handle_get_messages_since_reconnect(data):
    """Get messages since last known message ID after reconnect"""
    try:
        print(data)
        last_message_id = data.get('last_message_id')
        if not last_message_id:
            emit('error', {'message': 'last_message_id required'})
            return
        
        room = get_room(session.get('user_id'))
        recent_messages = get_recent_messages(room, 100)

        # Find index of the message with the given ID
        index = next((i for i, msg in enumerate(recent_messages) if msg['id'] == last_message_id), None)
        if index is None:
            emit('error', {'message': 'Message ID not found'})
            return

        # Get messages since that ID
        new_messages = recent_messages[index + 1:] if index + 1 < len(recent_messages) else []
        
        emit('messages_since_reconnect', {
            'messages': sanitize_for_json(new_messages),
            'count': len(new_messages)
        })
    
    except Exception as e:
        print(f"Socket.IO get messages since reconnect error: {e}")
        emit('error', {'message': 'Failed to get messages since reconnect'})
        
def handle_join_room(data):
    """Handle user joining a new room"""
    try:
        new_room = data.get('room')
        if not new_room:
            emit('error', {'message': 'Room name required'})
            return
        
        user_id = session.get('user_id')
        current_room = get_room(user_id)
        
        if new_room == current_room:
            emit('error', {'message': 'Already in the specified room'})
            return
        
        # Leave current room
        leave_room(current_room)
        
        # Join new room
        join_room(new_room)
        
        # Update user's current room in the database
        from scripts.user_manager import update_user_room
        update_user_room(user_id, new_room)
        
        emit('status', {
            'type': 'room_changed',
            'message': f'Joined room {new_room}',
            'data': {'room': new_room}
        })
        
    except Exception as e:
        print(f"Socket.IO join room error: {e}")
        emit('error', {'message': 'Failed to join room'})