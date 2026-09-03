ROWS = [
    {"room": "auth", "wing": "product"},
    {"room": "auth", "wing": "security"},
    {"room": "api", "wing": "product"},
    {"room": "legal", "wing": "legal"},
]

class Collection:
    def get(self, *, limit, offset, include):
        rows = ROWS[offset:offset + limit]
        return {"ids": [str(i) for i in range(offset, offset + len(rows))], "metadatas": rows}

class Backend:
    def get_or_create_collection(self, palace_path, collection_name):
        return Collection()
    def close_palace(self, palace_path):
        return None

def resolve_backend_for_palace(**kwargs):
    return "fixture"

def get_backend(name):
    return Backend()
