"""Thin pymongo access. The AI service reads staging data, join maps,
mappings and rules directly from MongoDB (same local instance as the Node
API), so heavy payloads never cross the HTTP boundary.
"""
from pymongo import MongoClient
from . import config

_client = None


def get_client():
    global _client
    if _client is None:
        _client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client


def db():
    return get_client()[config.DB_NAME]


collections = {
    "users": "users",
    "workflows": "workflows",
    "raw_transactions": "rawtransactions",
    "field_mappings": "fieldmappings",
    "join_maps": "joinmaps",
    "runs": "reconciliationruns",
    "breaks": "breaks",
    "investigations": "breakinvestigations",
    "reports": "reports",
    "audit": "auditlogs",
}


def coll(name):
    return db()[collections[name]]