from datetime import datetime, timezone
import json
from scripts.mongo_client import MongoDBClient

mongo_client = MongoDBClient()

def sanitize_for_json(obj):
    """Convert MongoDB ObjectIds to strings for JSON serialization"""
    # Check if it's a BSON ObjectId by checking the type string
    if str(type(obj)).find('ObjectId') != -1 or str(type(obj)).startswith("<class 'bson"):
        return str(obj)
    elif isinstance(obj, dict):
        return {key: sanitize_for_json(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item) for item in obj]
    else:
        # For any other non-serializable objects, convert to string
        try:
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            return str(obj)

def cache_message(message_data, user_id=None):
    if user_id is None:
        raise ValueError("user_id must be provided to cache messages")
    # Add timestamp to message
    message_data['timestamp'] = datetime.now(timezone.utc).isoformat()
    result = mongo_client.insert_message(user_id, message_data)
    return True

def get_message_collection(user_id):
    return mongo_client.get_message_collection(user_id)

def get_messages(user_id, query):
    return mongo_client.find_messages(user_id, query)

def get_recent_messages(user_id, limit=30):
    messages = mongo_client.find_messages(user_id, {})
    # Sort by timestamp and return most recent
    sorted_messages = sorted(messages, key=lambda x: x.get('timestamp', ''), reverse=True)
    return sorted_messages[:limit][::-1]  # Reverse to show oldest first

def get_messages_before(user_id, before_message_id, limit=10):
    """Get messages before a specific message ID"""
    all_messages = mongo_client.find_messages(user_id, {})
    # Sort by timestamp (newest first)
    sorted_messages = sorted(all_messages, key=lambda x: x.get('timestamp', ''), reverse=True)
    
    # Find the index of the message with the given ID
    before_index = None
    for i, msg in enumerate(sorted_messages):
        if msg.get('id') == before_message_id:
            before_index = i
            break
    
    if before_index is None:
        return []
    
    # Get messages that are older (higher index in the reverse-sorted array)
    older_messages = sorted_messages[before_index + 1:before_index + 1 + limit]
    # Return in chronological order (oldest first)
    return older_messages[::-1]

def get_room(user_id):
    _ME = "dtanh"
    if user_id == _ME:
        # Get user's current room from MongoDB
        user_doc = mongo_client.find_user({'username': _ME})
        if user_doc:
            return user_doc.get('room', _ME)
        return _ME
    return user_id