class MempalaceConfig:
    def __init__(self, palace_path=None):
        self.palace_path = palace_path or "fixture-palace"
        self.collection_name = "fixture"
        self.backend = "fixture"
