#!/bin/bash
# box-status.sh - one-shot, read-only JSON status of a Linux box for the linuxbox-monitor pane.
# Install on the box (e.g. ~/bin/box-status.sh, chmod +x). Everything optional is set in
# ~/.config/box-status.env (see the README); with no settings it reports load, memory and drives.
CONF="${BOX_STATUS_CONF:-$HOME/.config/box-status.env}"
[ -f "$CONF" ] && set -a && . "$CONF" && set +a
exec python3 -I - <<'PY'
import json, os, re, subprocess, urllib.request
E = os.environ.get
def sh(c):
    try: return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception: return ""
def home(p): return os.path.expanduser(p) if p else p
o = {"name": E("BOX_NAME", "")}

la = os.getloadavg(); o["load"] = [round(x, 1) for x in la]; o["cores"] = os.cpu_count()
m = {}
for l in open("/proc/meminfo"):
    k, v = l.split(":"); m[k] = int(v.split()[0])
o["memAvailGB"] = round(m["MemAvailable"] / 1048576, 1); o["memTotalGB"] = round(m["MemTotal"] / 1048576, 1)
o["swapUsedGB"] = round((m["SwapTotal"] - m["SwapFree"]) / 1048576, 1)

# Drives: BOX_DRIVES="Name=/mount,Other=/mnt/x" or, unset, every real filesystem mounted
wanted = [p.split("=", 1) for p in E("BOX_DRIVES", "").split(",") if "=" in p]
if not wanted:
    real = ("ext4", "ext3", "xfs", "btrfs", "f2fs", "ntfs", "ntfs3", "fuseblk", "exfat", "vfat", "zfs")
    seen = set()
    for line in open("/proc/mounts"):
        dev, mnt, fs = line.split()[:3]
        mnt = mnt.replace("\\040", " ")
        if fs not in real or mnt.startswith(("/boot", "/snap", "/var/snap")) or dev in seen: continue
        seen.add(dev)
        wanted.append([E("BOX_ROOT_NAME", "system") if mnt == "/" else os.path.basename(mnt) or mnt, mnt])
disks = []
for name, mnt in wanted:
    try:
        if mnt != "/" and not os.path.ismount(mnt): raise OSError
        s = os.statvfs(mnt)
        disks.append({"name": name, "freeGB": round(s.f_bavail * s.f_frsize / 1e9), "usedPct": round(100 - 100 * s.f_bavail / s.f_blocks)})
    except OSError:
        disks.append({"name": name, "freeGB": None, "usedPct": None})
o["disks"] = disks

# Batch jobs: systemd --user services matching BOX_JOBS (a glob) whose log prints lines like "[3/10] name"
o["batches"], o["jobs"], o["batchStatus"] = [], [], ""
pat = E("BOX_JOBS", "")
if pat:
    units = [u.replace(".service", "") for u in sh("systemctl --user list-units --type=service --state=active --no-legend %s | awk '{print $1}'" % json.dumps(pat)).split()]
    o["batches"] = units
    for u in units:
        desc = sh("systemctl --user show -p Description --value %s" % u)
        since = sh("systemctl --user show -p ActiveEnterTimestamp --value %s" % u)
        last = sh(r'''journalctl --user -u %s --since "%s" --no-pager -o cat | grep -E '^\[[0-9]+/[0-9]+\]' | tail -n 1''' % (u, since))
        mm = re.match(r"\[(\d+)/(\d+)\]\s+(.*)", last)
        o["jobs"].append({"unit": u, "desc": desc, "n": int(mm.group(1)) if mm else None,
                          "total": int(mm.group(2)) if mm else None, "name": mm.group(3) if mm else ""})
    o["jobs"].sort(key=lambda j: j["n"] is None)

# Plex: needs a token file (PLEX_TOKEN_FILE); the token is read here and never printed
o["plexConfigured"] = False; o["plexUp"] = False; o["watching"] = []; o["plexJobs"] = []
tf = home(E("PLEX_TOKEN_FILE", ""))
if tf and os.path.exists(tf):
    o["plexConfigured"] = True
    tok = open(tf).read().strip(); base = E("PLEX_URL", "http://127.0.0.1:32400")
    def plex(p):
        r = urllib.request.Request(base + p, headers={"X-Plex-Token": tok, "Accept": "application/json"})
        return json.load(urllib.request.urlopen(r, timeout=8))["MediaContainer"]
    try:
        s = plex("/status/sessions")
        o["watching"] = [{"title": (x.get("grandparentTitle") + " - " if x.get("grandparentTitle") else "") + x.get("title", ""),
                          "user": x.get("User", {}).get("title", ""), "state": x.get("Player", {}).get("state", ""),
                          "transcode": (x.get("TranscodeSession") or {}).get("videoDecision", "direct")} for x in s.get("Metadata", [])]
        a = plex("/activities")
        o["plexJobs"] = [{"type": x.get("type", "").replace("media.generate.", ""), "title": x.get("title", ""),
                          "item": x.get("subtitle", ""), "progress": x.get("progress")} for x in a.get("Activity", [])]
        o["plexUp"] = True
    except Exception:
        pass

# Drive health: optional log whose last line holds key=value pairs (total_bad_sectors, new_bad_sectors, ext4_errors, mount)
o["overflow"] = None; o["overflowAlert"] = None; o["healthName"] = E("BOX_HEALTH_NAME", "drive")
hl = home(E("BOX_HEALTH_LOG", ""))
if hl and os.path.exists(hl):
    try:
        line = open(hl).read().strip().splitlines()[-1]
        kv = dict(p.split("=", 1) for p in line.split() if "=" in p)
        o["overflow"] = {"date": line[:16], "badSectors": kv.get("total_bad_sectors", "?"), "new": kv.get("new_bad_sectors", "0"),
                         "ext4Errors": kv.get("ext4_errors", "0"), "mount": kv.get("mount", "ok")}
    except Exception:
        pass
ha = home(E("BOX_HEALTH_ALERT", ""))
if ha and os.path.exists(ha): o["overflowAlert"] = os.path.getmtime(ha)

# Every monitored drive, for the health card: the one above plus BOX_HEALTH_EXTRA, a comma-separated
# list of Name=logfile[:alertfile]. Each log's last line holds key=value pairs (any keys; the pane knows
# total_bad_sectors, new_bad_sectors, ext4_errors, usb_resets, timeouts, io_errors, fs_errors, mount).
def health_entry(name, log, alert):
    log, alert = home(log), home(alert)
    if not log or not os.path.exists(log): return None
    try:
        line = open(log).read().strip().splitlines()[-1]
    except Exception:
        return None
    kv = dict(p.split("=", 1) for p in line.split() if "=" in p)
    if "drive_not_found" in line: kv["mount"] = "missing"
    return {"name": name, "date": line[:16], "kv": kv,
            "alert": os.path.getmtime(alert) if alert and os.path.exists(alert) else None}
o["health"] = []
first = health_entry(o["healthName"], E("BOX_HEALTH_LOG", ""), E("BOX_HEALTH_ALERT", ""))
if first: o["health"].append(first)
for item in [p for p in E("BOX_HEALTH_EXTRA", "").split(",") if "=" in p]:
    name, rest = item.split("=", 1)
    log, _, alert = rest.partition(":")
    h = health_entry(name.strip(), log.strip(), alert.strip())
    if h: o["health"].append(h)

# A docker container to show in the footer (BOX_CONTAINER=name)
c = E("BOX_CONTAINER", "")
o["container"] = c
o["containerStatus"] = sh("docker ps --filter name=%s --format '{{.Status}}'" % json.dumps(c)) if c else ""
o["time"] = sh("date +%H:%M:%S")
print(json.dumps(o))
PY
