#!/bin/bash
# box-status.sh - one-shot, read-only JSON status of a Linux box for the linuxbox-monitor pane.
# Install on the box (e.g. ~/bin/box-status.sh, chmod +x). Everything optional is set in
# ~/.config/box-status.env (see the README); with no settings it reports load, memory and drives.
CONF="${BOX_STATUS_CONF:-$HOME/.config/box-status.env}"
[ -f "$CONF" ] && set -a && . "$CONF" && set +a
exec python3 -I - <<'PY'
import glob, json, os, re, subprocess, urllib.request
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

# Batch jobs: active systemd --user services matching BOX_JOBS (one or more globs, space or comma separated).
# Progress comes from the journal ("[3/10] name" lines) or, failing that, from BOX_JOB_LOGS/<unit>.log
# (also tried without an "hb-" prefix) with "START name" / "OK name" / "FAIL name" lines.
# A service whose only processes are shells and sleep is reported as waiting.
o["batches"], o["jobs"], o["batchStatus"] = [], [], ""
pats = [p for p in re.split(r"[,\s]+", E("BOX_JOBS", "")) if p]
logdir = home(E("BOX_JOB_LOGS", ""))
MEDIA = re.compile(r"\.(mkv|mp4|avi|m4v|ts|mov|wmv|webm)$", re.I)
SHELLS = {"bash", "sh", "dash", "sleep"}
def unit_procs(u):
    cg = sh("systemctl --user show -p ControlGroup --value %s" % u)
    out = []
    if not cg: return out
    for root, _, files in os.walk("/sys/fs/cgroup" + cg):
        if "cgroup.procs" not in files: continue
        try: pids = open(os.path.join(root, "cgroup.procs")).read().split()
        except OSError: continue
        for pid in pids:
            try: out.append(open("/proc/%s/comm" % pid).read().strip())
            except OSError: pass
    return out
def item_name(rest):
    rest = re.sub(r"^\(exists\)\s*", "", rest.strip())
    rest = re.split(r":\s", rest, maxsplit=1)[0] if not rest.startswith("/") else rest
    return os.path.basename(rest) if "/" in rest else rest
if pats:
    units = [u.replace(".service", "") for u in sh("systemctl --user list-units --type=service --state=active --no-legend %s | awk '{print $1}'"
                                                    % " ".join(json.dumps(p) for p in pats)).split()]
    o["batches"] = units
    for u in units:
        desc = sh("systemctl --user show -p Description --value %s" % u)
        since = sh("systemctl --user show -p ActiveEnterTimestamp --value %s" % u)
        since_s = int(sh("date -d %s +%%s" % json.dumps(since)) or 0)
        last = sh(r'''journalctl --user -u %s --since "%s" --no-pager -o cat | grep -E '^\[[0-9]+/[0-9]+\]' | tail -n 1''' % (u, since))
        mm = re.match(r"\[(\d+)/(\d+)\]\s+(.*)", last)
        procs = unit_procs(u)
        waiting = "sleep" in procs and all(p in SHELLS or p.endswith(".sh") for p in procs)
        waits = re.search(r"waits for ([^)]*)", desc) or re.search(r"is-active -q ([\w@.-]+)", desc)
        label = u if desc.startswith("[systemd-run]") else re.sub(r"\s*\(waits for [^)]*\)", "", desc)
        job = {"unit": u, "desc": desc, "label": label, "state": "waiting" if waiting else "running",
               "waitsFor": waits.group(1).strip() if waits else "",
               "n": int(mm.group(1)) if mm else None, "total": int(mm.group(2)) if mm else None,
               "name": mm.group(3) if mm else "", "done": None, "failed": 0}
        pid = sh("systemctl --user show -p MainPID --value %s" % u)
        try: args = open("/proc/%s/cmdline" % pid, "rb").read().decode(errors="replace").split("\0")
        except OSError: args = []
        if job["total"] is None:  # the media files handed to the service, or the lines of a .list file it was given
            k = sum(1 for a in args if MEDIA.search(a))
            for a in args:
                if not k and a.endswith(".list") and os.path.isfile(a):
                    k = sum(1 for l in open(a, errors="replace") if l.strip())
            if k: job["total"] = k
        if not mm and logdir:
            tag = next((args[i + 1] for i, a in enumerate(args[:-1]) if a == "--tag"), "")
            cands = [os.path.join(logdir, c + ".log") for c in (u, re.sub(r"^hb-", "", u))]
            if tag: cands += sorted(glob.glob(os.path.join(logdir, "*-%s.log" % glob.escape(tag))), key=os.path.getmtime, reverse=True)
            for lf in cands:
                if not os.path.exists(lf) or os.path.getmtime(lf) < since_s - 60: continue
                done = failed = skipped = 0; cur = ""
                for line in open(lf, errors="replace"):
                    hdr = re.search(r":\s+(\d+) (?:films|episodes|files|items)\b", line)
                    if hdr and job["total"] is None: job["total"] = int(hdr.group(1))
                    t = re.match(r"^(?:[\d:\- ]+\s)?(START|OK|FAIL|SKIP)\b\s*(.*)", line)
                    if not t: continue
                    if t.group(1) == "START": cur = item_name(t.group(2))
                    else:
                        done += 1; failed += t.group(1) == "FAIL"; skipped += t.group(1) == "SKIP"
                        if cur and cur in t.group(2): cur = ""
                        if t.group(1) != "SKIP": job["name"] = re.sub(r"\s+\d+ -> .*$", "", item_name(t.group(2)))
                job["done"], job["failed"], job["skipped"] = done, failed, skipped
                if cur: job["name"] = cur
                job["current"] = bool(cur)
                if cur:  # how far through the current item, from its ffmpeg log (<logdir>/**/<item>.log)
                    il = sorted(glob.glob(os.path.join(logdir, "**", glob.escape(cur) + ".log"), recursive=True), key=os.path.getmtime)
                    if il and os.path.getmtime(il[-1]) >= since_s - 60:
                        txt = open(il[-1], errors="replace").read()[-200000:]
                        d = re.search(r"Duration: (\d+):(\d\d):(\d\d)", open(il[-1], errors="replace").read(20000))
                        ts = re.findall(r"time=(\d+):(\d\d):(\d\d)", txt)
                        sp = re.findall(r"speed=\s*([\d.]+)x", txt)
                        if d and ts:
                            dur = int(d[1]) * 3600 + int(d[2]) * 60 + int(d[3]); h, m_, s_ = ts[-1]
                            pos = int(h) * 3600 + int(m_) * 60 + int(s_)
                            if dur: job["itemPct"] = min(100, round(100 * pos / dur))
                            if dur and sp and float(sp[-1]) > 0: job["itemEtaMin"] = round((dur - pos) / float(sp[-1]) / 60)
                break
        o["jobs"].append(job)
    o["jobs"].sort(key=lambda j: (j["state"] == "waiting", j["n"] is None and j["done"] is None))

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
