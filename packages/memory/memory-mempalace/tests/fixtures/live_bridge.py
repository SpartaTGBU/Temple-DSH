import runpy
import sys
from pathlib import Path

here = Path(__file__).parent
sys.path.insert(0, str(here / "python"))
runpy.run_path(str(here.parent.parent / "resources" / "bridge.py"), run_name="__main__")
