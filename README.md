# linuxbox-monitor

A Claude Code mod that keeps a live, slightly playful pane beside the chat for a Linux box you reach over SSH. It refreshes every minute and shows:

- **A mascot** whose face, sweat, steam and fan speed follow the load, plus ring gauges for load and memory.
- **Drives** as battery bars coloured by free space.
- **Batch jobs** (for example a run of video encodes) as a film strip, one frame per item, with what is queued next.
- **Plex**: who is actually watching (direct play or transcode), kept apart from Plex's background analysis (loudness, intros, credits, thumbnails), so a busy CPU is not mistaken for playback.
- **Drive health** from a log you keep, as a heartbeat that speeds up and turns red if things get worse.

It also puts a one-line summary in the status line, and adds `/box` to reopen and refresh the pane.

Everything it runs on the box is read-only.

## Install

At the prompt of a terminal session:

```
/plugin install linuxbox-monitor --marketplace jjkc29-ai/linuxbox-monitor
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install linuxbox-monitor --marketplace jjkc29-ai/linuxbox-monitor`. In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `jjkc29-ai/linuxbox-monitor`, then Add plugin.

## Set up the box

1. Make sure `ssh <host> true` works from your computer with no password prompt (key login), and that the box has `python3`.
2. Copy `scripts/box-status.sh` to the box, for example to `~/bin/box-status.sh`, and `chmod +x` it.
3. In the mod's settings, set **SSH host** (default `linuxbox`) and, if you put the script elsewhere, **Status script on the box**.

With no further setup it shows load, memory and every mounted drive. Optional extras go in `~/.config/box-status.env` on the box:

```sh
BOX_NAME="My server"                 # name under the mascot
BOX_DRIVES="System=/,Media=/mnt/media" # name=mountpoint pairs; unset = every real filesystem
BOX_ROOT_NAME=system                 # label for / when auto-detecting
BOX_JOBS="encode-*"                  # systemd --user services to show; their log should print lines like "[3/10] item name"
PLEX_TOKEN_FILE=~/.plex-token        # enables the Plex card; the token is read on the box and never sent anywhere else
PLEX_URL=http://127.0.0.1:32400
BOX_HEALTH_LOG=~/disk-health.log     # last line with key=value pairs: total_bad_sectors, new_bad_sectors, ext4_errors, mount
BOX_HEALTH_ALERT=~/DISK-ALERT.txt    # a file whose recent change flags an alert
BOX_HEALTH_NAME=media                # which drive the health log is about
BOX_HEALTH_EXTRA="usb=~/usb-health.log:~/USB-ALERT.txt"  # more drives: Name=log[:alert], comma-separated; also reads usb_resets, timeouts, io_errors, fs_errors
BOX_CONTAINER=myapp                  # a docker container whose status goes in the footer
```

Cards with nothing configured (Plex, jobs, drive health) are simply left out.
