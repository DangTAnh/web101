
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
import os
from dotenv import load_dotenv

load_dotenv()

username = os.getenv('MONGODB_USERNAME')
password = os.getenv('MONGODB_PASSWORD')

if not username or not password:
    raise ValueError("MONGODB_USERNAME and MONGODB_PASSWORD must be set in environment variables")

uri = f"mongodb+srv://{username}:{password}@cluster0.m3kg7da.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"

class MongoDBClient:
    def __init__(self):
        self.client = MongoClient(uri, server_api=ServerApi('1'))
        self.user_db = self.client["userdata"]
        self.user_collection = self.user_db["data"]
        self.sessions_collection = self.user_db["sessions"]
        self.login_history_collection = self.user_db["login_history"]
        self.message_db = self.client["messages"]

    def insert_user(self, user_data):
        result = self.user_collection.insert_one(user_data)
        return result.inserted_id

    def find_user(self, query):
        return self.user_collection.find_one(query)

    def update_user(self, query, update_data):
        result = self.user_collection.update_one(query, {'$set': update_data})
        return result.modified_count

    def delete_user(self, query):
        result = self.user_collection.delete_one(query)
        return result.deleted_count
    
    def insert_session(self, session_data):
        result = self.sessions_collection.insert_one(session_data)
        return result.inserted_id
    
    def find_session(self, query):
        return self.sessions_collection.find_one(query)
    
    def update_session(self, query, update_data):
        result = self.sessions_collection.update_one(query, {'$set': update_data})
        return result.modified_count
    
    def delete_session(self, query):
        result = self.sessions_collection.delete_one(query)
        return result.deleted_count
    
    def count_sessions(self, query):
        return self.sessions_collection.count_documents(query)
    
    def insert_login_history(self, login_data):
        result = self.login_history_collection.insert_one(login_data)
        return result.inserted_id
    
    def get_login_history_collection(self):
        return self.login_history_collection
    
    def get_login_history(self, limit=100):
        history = list(self.login_history_collection.find().sort('_id', -1).limit(limit))
        # Convert ObjectId to string for JSON serialization
        for record in history:
            if '_id' in record:
                record['_id'] = str(record['_id'])
        return history

    def get_login_history_by_user(self, user_id, limit=100):
        history = list(self.login_history_collection.find({"user_id": user_id}).sort('_id', -1).limit(limit))
        # Convert ObjectId to string for JSON serialization
        for record in history:
            if '_id' in record:
                record['_id'] = str(record['_id'])
        return history

    def get_message_collection(self, user_id):
        return self.message_db[f"messages_{user_id}"]
    
    def insert_message(self, user_id, message_data):
        collection = self.get_message_collection(user_id)
        result = collection.insert_one(message_data)
        return str(result.inserted_id)
    
    def find_messages(self, user_id, query):
        collection = self.get_message_collection(user_id)
        messages = list(collection.find(query))
        # Convert ObjectId to string for JSON serialization
        for message in messages:
            if '_id' in message:
                message['_id'] = str(message['_id'])
        return messages
    
    def update_message(self, user_id, query, update_data):
        collection = self.get_message_collection(user_id)
        result = collection.update_one(query, {'$set': update_data})
        return result.modified_count
    
    def delete_message(self, user_id, query):
        collection = self.get_message_collection(user_id)
        result = collection.delete_one(query)
        return result.deleted_count