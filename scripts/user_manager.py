from datetime import datetime, timezone
from scripts.mongo_client import MongoDBClient

mongo_client = MongoDBClient()

def load_users():
    """Load users from MongoDB, create default if empty"""
    users = {}
    
    # Try to load existing users from MongoDB
    all_users = mongo_client.user_collection.find({})
    for user_doc in all_users:
        username = user_doc.get('username')
        if username:
            users[username] = {
                'password_hash': user_doc.get('password_hash'),
                'email': user_doc.get('email'),
                'role': user_doc.get('role', 'user'),
                'room': user_doc.get('room', username)
            }
    
    # Create default users if none exist
    if not users:
        default_users = {
            "admin": {
                "password_hash": "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",  # "admin"
                "email": "admin@example.com",
                "role": "admin",
                "room": "admin"
            },
            "user": {
                "password_hash": "04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb",  # "user123"
                "email": "user@example.com", 
                "role": "user",
                "room": "user"
            }
        }
        
        # Insert default users into MongoDB
        for username, user_data in default_users.items():
            user_doc = {
                'username': username,
                'password_hash': user_data['password_hash'],
                'email': user_data['email'],
                'role': user_data['role'],
                'room': user_data['room'],
                'created_at': datetime.now(timezone.utc).isoformat()
            }
            mongo_client.insert_user(user_doc)
            users[username] = user_data
    
    return users

def save_user(username, user_data):
    """Save or update user in MongoDB"""
    user_doc = {
        'username': username,
        'password_hash': user_data['password_hash'],
        'email': user_data['email'],
        'role': user_data['role'],
        'room': user_data.get('room', username),
        'updated_at': datetime.now(timezone.utc).isoformat()
    }
    
    # Try to update existing user, insert if not found
    result = mongo_client.update_user({'username': username}, user_doc)
    if result == 0:  # No document was updated, insert new
        user_doc['created_at'] = datetime.now(timezone.utc).isoformat()
        mongo_client.insert_user(user_doc)