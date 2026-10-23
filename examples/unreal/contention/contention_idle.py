# Run inside a throwaway editor by contention_demo.mjs: writes the file named by AGENT_UNREAL_READY_FILE so the runner knows
# the editor finished starting. Then it returns and leaves the editor open and idle, or, when AGENT_UNREAL_BUSY_SECONDS is set,
# keeps the editor's game thread busy for that long (an editor that is compiling or cooking rather than waiting).
import os
import time

with open(os.environ["AGENT_UNREAL_READY_FILE"], "w", encoding="utf-8") as f:
    f.write("ready")

end = time.time() + float(os.environ.get("AGENT_UNREAL_BUSY_SECONDS", "0"))
while time.time() < end:
    pass
