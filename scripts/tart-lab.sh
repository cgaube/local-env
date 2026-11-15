#!/usr/bin/env bash
# tart-lab.sh: a two-VM lab to test local-env on a clean Mac, with Tart.
#
#   - Linux VM (Ubuntu): runs Docker and is the Docker engine of the lab.
#   - macOS VM: the clean Mac where you run the onboarding script and
#     local-env. Its DOCKER_HOST points at the Linux VM.
#   - Host bridge: SSH tunnels on this Mac join the two, as Tart's VMs can't
#     reach each other.
#
# Usage:
#   scripts/tart-lab.sh up              start everything (idempotent)
#   scripts/tart-lab.sh down            stop everything and reset the lab: the
#                                       next `up` gives a Mac that never ran
#                                       local-env (see "Fresh start" below)
#   scripts/tart-lab.sh down --keep     only stop: the next `up` resumes
#   scripts/tart-lab.sh down --clean    as down, and removes the state folder
#   scripts/tart-lab.sh down --purge    as --clean, and deletes both VMs
#   scripts/tart-lab.sh status          show the VMs, the tunnels and Docker
#   scripts/tart-lab.sh env             print the exports for the macOS VM
#   scripts/tart-lab.sh ssh linux|mac   open a shell in a VM
#
# Settings (environment variables, with their defaults):
#   LINUX_VM_NAME=local-env-linux
#   MAC_OS_VM_NAME=local-env-mac
#   LINUX_BASE_IMAGE=ghcr.io/cirruslabs/ubuntu:latest
#   MAC_OS_BASE_IMAGE=ghcr.io/cirruslabs/macos-golden-gate-base:latest
#   TUNNEL_PORT=23750           port of the Docker tunnel on the host
#   TUNNEL_BIND=<gateway>       address of the Docker tunnel on the host: the
#                               gateway of Tart's network (192.168.64.1), so
#                               the VMs reach it and the LAN does not.
#                               0.0.0.0 opens it to every interface.
#   DOCKER_TCP_BIND=127.0.0.1   address dockerd listens on in the Linux VM
#   FORWARD_PORTS="80 443 17300"  ports of the core stack that the macOS VM
#                               reaches on its 127.0.0.1 (proxy, Dockhand)
#   AGENT_PORT=17081            port of local-env's dashboard agent
#   VM_USER=admin VM_PASSWORD=admin   the login of the Cirrus Labs images
#   MAC_OS_GRAPHICS=1           0 runs the macOS VM without a window
#   BOOT_TIMEOUT=180            seconds to wait for a VM's IP and SSH
#   TART_LAB_STATE_DIR=~/.local/state/local-env-tart-lab
#
# Base images: a VM that does not exist is cloned from its base image
# (`tart clone <image> <name>`, which pulls the image the first time). Any
# local VM or OCI reference works, for example
#   MAC_OS_BASE_IMAGE=mac-master-template scripts/tart-lab.sh up
#
# Fresh start: `down` deletes the macOS VM (only one this script cloned; a
# clone is a copy-on-write copy of the base image, so cloning again takes
# seconds), empties the shared local-env home, and has the next `up` remove
# everything in the Linux VM's Docker (containers, volumes, networks, images,
# build cache). The Linux VM itself is kept, with Docker installed.
#
# How the virtualization hurdles are solved:
#
#   1. Guest-to-guest isolation. The VMs are on the host's vmnet network
#      (192.168.64.0/24), but they can't reach each other there. Each one can
#      reach the host at the gateway (192.168.64.1), and the host can reach
#      both, so the host relays with SSH:
#      - Docker: `ssh -L <gateway>:<port>:localhost:2375 admin@<linux-ip>`
#        listens on the gateway and forwards to port 2375 in the Linux VM.
#        The macOS VM uses DOCKER_HOST=tcp://192.168.64.1:<port>.
#      - The core stack's ports: local-env calls Dockhand and the proxy on
#        127.0.0.1, but their ports are published in the Linux VM. One SSH
#        session forwards a Unix socket on the host to each port in the Linux
#        VM (-L), another forwards each port on the macOS VM's 127.0.0.1 to
#        that socket (-R). Sockets, not ports, so they never clash with a
#        local-env that runs on the host. macOS lets a user bind a port below
#        1024 on the wildcard address only, so 80 and 443 arrive on 20080 and
#        20443, and a pf rule (anchor com.apple/tart-lab) redirects
#        127.0.0.1:80 and :443 to them.
#
#   2. Daemon binding. Ubuntu's dockerd listens only on its unix socket. The
#      script writes a systemd drop-in that adds `-H tcp://<bind>:2375` to
#      ExecStart (and keeps `-H fd://`, so the socket still works), then
#      reloads systemd and restarts Docker, only when the file changes. The
#      tunnel ends inside the VM, so loopback (127.0.0.1) is enough and the
#      unauthenticated TCP port is not on the vmnet network.
#
#   3. Bind mounts. local-env's compose file mounts folders of its home
#      (~/.local-env): with a remote engine, Docker looks for them in the
#      Linux VM. The script shares one host folder ($STATE_DIR/home) with
#      both VMs (`tart run --dir`, tag local-env-home) and mounts it at
#      /Users/admin/.local-env in each, so the paths are the same on both
#      sides. A home the macOS VM had before is copied into it once.
#
#   4. The dashboard agent. The dashboard calls it on
#      host.docker.internal:17081, a name a plain Linux engine does not
#      define, and the agent runs in the macOS VM. In the Linux VM, a dummy
#      interface holds 192.0.2.1, /etc/hosts names it host.docker.internal,
#      systemd-resolved also listens there, and dockerd uses it as its DNS
#      (daemon.json), so containers resolve the name. sshd listens on
#      192.0.2.1:17081 (-R, with GatewayPorts clientspecified) and forwards
#      to a host socket, which the macOS VM's tunnel (-L) forwards to the
#      agent on its 127.0.0.1:17081.
#
# Not covered: template builds and ${HOST_HOME} mounts.
#
# SSH: the script makes its own key in the state folder and installs it in
# each VM on first contact, with the image's password given by SSH_ASKPASS
# (no sshpass). Host keys are not checked: the VMs are local and throwaway,
# and a clone gets a new key and often a new IP.

set -euo pipefail

LINUX_VM_NAME="${LINUX_VM_NAME:-local-env-linux}"
MAC_OS_VM_NAME="${MAC_OS_VM_NAME:-local-env-mac}"
LINUX_BASE_IMAGE="${LINUX_BASE_IMAGE:-ghcr.io/cirruslabs/ubuntu:latest}"
MAC_OS_BASE_IMAGE="${MAC_OS_BASE_IMAGE:-ghcr.io/cirruslabs/macos-golden-gate-base:latest}"
TUNNEL_PORT="${TUNNEL_PORT:-23750}"
TUNNEL_BIND="${TUNNEL_BIND:-}"
DOCKER_TCP_BIND="${DOCKER_TCP_BIND:-127.0.0.1}"
DOCKER_TCP_PORT=2375
FORWARD_PORTS="${FORWARD_PORTS:-80 443 17300}"
AGENT_PORT="${AGENT_PORT:-17081}"
# host.docker.internal in the Linux VM: an address on a dummy interface, in
# TEST-NET-1 (192.0.2.0/24, never routed), so it clashes with no network
LAB_HOST_IP=192.0.2.1
VM_USER="${VM_USER:-admin}"
VM_PASSWORD="${VM_PASSWORD:-admin}"
MAC_OS_GRAPHICS="${MAC_OS_GRAPHICS:-1}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"
STATE_DIR="${TART_LAB_STATE_DIR:-$HOME/.local/state/local-env-tart-lab}"

SSH_KEY="$STATE_DIR/id_ed25519"
ASKPASS="$STATE_DIR/askpass.sh"
SOCK_DIR="$STATE_DIR/sock"
SHARE_DIR="$STATE_DIR/home"
SHARE_TAG=local-env-home
# local-env's home in both VMs: the same path, so bind mounts resolve
LAB_HOME="/Users/$VM_USER/.local-env"
PF_ANCHOR=com.apple/tart-lab
TUNNELS=(docker linux-ports mac-ports)

# --- output -----------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\e[1m' DIM=$'\e[2m' RED=$'\e[31m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RESET=$'\e[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' RESET=''
fi
step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

# --- prerequisites ----------------------------------------------------------

check_prerequisites() {
  [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
    die 'Tart needs a Mac with Apple Silicon.'
  command -v tart >/dev/null ||
    die 'tart is not installed: brew install cirruslabs/cli/tart'
  local cmd port
  for cmd in ssh ssh-keygen nc curl; do
    command -v "$cmd" >/dev/null || die "$cmd is missing."
  done
  for port in "$TUNNEL_PORT" $FORWARD_PORTS; do
    [[ "$port" =~ ^[0-9]+$ ]] || die "not a port: $port"
  done
  mkdir -p "$STATE_DIR" "$SOCK_DIR" "$SHARE_DIR"
  chmod 700 "$STATE_DIR" "$SOCK_DIR"
}

# --- tart helpers -----------------------------------------------------------

vm_exists() { tart get "$1" >/dev/null 2>&1; }

vm_running() {
  # `tart list --format json` prints one key per line: keep the name, print it
  # when its Running is true.
  tart list --source local --format json | awk -v name="$1" '
    /"Name"/ { n = $0; sub(/.*"Name" *: *"/, "", n); sub(/".*/, "", n) }
    /"Running" *: *true/ && n == name { found = 1 }
    END { exit !found }'
}

# True while the VM runs or its `tart run` process lives: `tart list` can say
# a booting or running macOS VM is not running.
vm_alive() { vm_running "$1" || pgrep -qf "tart run $1( |\$)"; }

# Clones the VM from its base image when it does not exist. Tart pulls an OCI
# image the first time; a local VM name works too.
ensure_vm() {
  local name="$1" base="$2"
  if vm_exists "$name"; then
    ok "$name exists"
    return
  fi
  info "$name does not exist: cloning it from $base"
  if ! tart clone "$base" "$name"; then
    die "could not clone $base. Pull it (tart pull $base) or set the base image variable to a VM from \`tart list\`."
  fi
  # Only a VM this script cloned is deleted by `down`
  touch "$STATE_DIR/$name.cloned"
  ok "$name cloned from $base"
}

# Shuts the guest down from inside first, so it flushes its disks: a VM cut
# off can corrupt Docker's databases. `tart stop` is the fallback, and forces
# it off after its timeout.
stop_vm() {
  local name="$1" ip deadline=$((SECONDS + 90))
  if ip="$(tart ip "$name" 2>/dev/null)" && [[ -f "$SSH_KEY" ]]; then
    vm_ssh "$ip" 'sudo -n shutdown -h now' >/dev/null 2>&1 || true
    while vm_alive "$name" && ((SECONDS < deadline - 30)); do sleep 1; done
  fi
  vm_alive "$name" && { tart stop --timeout 30 "$name" >/dev/null 2>&1 || true; }
  while vm_alive "$name" && ((SECONDS < deadline)); do sleep 1; done
  vm_alive "$name" && die "$name does not stop."
  rm -f "$STATE_DIR/$name.run"
}

# Starts the VM in the background, detached from this shell. A VM that runs
# with other options (the shared folder, from an earlier version or by hand)
# is restarted: Tart sets them at boot only.
start_vm() {
  local name="$1" graphics="$2"
  local args=(run "$name" --dir "$SHARE_DIR:tag=$SHARE_TAG")
  [[ "$graphics" == 1 ]] || args+=(--no-graphics)
  local spec="${args[*]}" run_file="$STATE_DIR/$name.run"
  if vm_alive "$name"; then
    if [[ "$(cat "$run_file" 2>/dev/null)" == "$spec" ]]; then
      ok "$name is already running"
      return
    fi
    warn "$name runs without the lab's shared folder: restarting it"
    stop_vm "$name"
  fi
  nohup tart "${args[@]}" >"$STATE_DIR/$name.log" 2>&1 </dev/null &
  disown
  printf '%s\n' "$spec" >"$run_file"
  # A VM that fails to start (locked, no disk space) exits at once.
  sleep 2
  vm_alive "$name" || die "$name did not start: see $STATE_DIR/$name.log"
  ok "$name started (log: $STATE_DIR/$name.log)"
}

# Polls `tart ip` until the VM has an address, then until its SSH port opens.
# Prints the IP.
wait_for_vm() {
  local name="$1" deadline=$((SECONDS + BOOT_TIMEOUT)) ip=''
  while ((SECONDS < deadline)); do
    vm_alive "$name" || die "$name stopped while booting: see $STATE_DIR/$name.log"
    ip="$(tart ip "$name" 2>/dev/null || true)"
    [[ -n "$ip" ]] && break
    sleep 2
  done
  [[ -n "$ip" ]] || die "$name has no IP after ${BOOT_TIMEOUT}s."
  while ((SECONDS < deadline)); do
    if nc -z -G 2 "$ip" 22 >/dev/null 2>&1; then
      printf '%s\n' "$ip"
      return
    fi
    sleep 2
  done
  die "SSH of $name ($ip) did not open after ${BOOT_TIMEOUT}s."
}

# --- ssh helpers ------------------------------------------------------------

SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR
  -o ConnectTimeout=5
)

ensure_ssh_key() {
  [[ -f "$SSH_KEY" ]] || ssh-keygen -q -t ed25519 -N '' -C tart-lab -f "$SSH_KEY"
  # SSH_ASKPASS gives the image's password to ssh without a terminal.
  # shellcheck disable=SC2016 # expanded by the askpass script, not here
  printf '#!/bin/sh\nprintf "%%s\\n" "$TART_LAB_PASSWORD"\n' >"$ASKPASS"
  chmod 700 "$ASKPASS"
}

vm_ssh() {
  local ip="$1"
  shift
  ssh "${SSH_OPTS[@]}" -o BatchMode=yes -i "$SSH_KEY" "$VM_USER@$ip" "$@"
}

# Installs the lab's key in the VM, once, with the password of the image.
authorize_key() {
  local ip="$1" name="$2"
  if vm_ssh "$ip" true 2>/dev/null; then
    return
  fi
  info "installing the lab's SSH key in $name"
  TART_LAB_PASSWORD="$VM_PASSWORD" SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force \
    ssh "${SSH_OPTS[@]}" -o PreferredAuthentications=password,keyboard-interactive \
    -o PubkeyAuthentication=no "$VM_USER@$ip" \
    'umask 077 && mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' <"$SSH_KEY.pub" ||
    die "could not log in to $name as $VM_USER: set VM_USER and VM_PASSWORD."
  vm_ssh "$ip" true || die "the key does not work in $name."
}

# --- linux: docker over tcp, shared home --------------------------------------

# Installs Docker when the image has none, then makes dockerd listen on TCP
# with a systemd drop-in. It restarts Docker only when the drop-in changes.
# With reset=1 it first deletes Docker's data (containers, volumes, networks,
# images, build cache): the files, not through the daemon, so a corrupted
# database is no obstacle.
configure_docker() {
  local ip="$1" reset="$2"
  vm_ssh "$ip" sudo bash -s -- "$DOCKER_TCP_BIND" "$DOCKER_TCP_PORT" "$VM_USER" "$reset" "$LAB_HOST_IP" <<'REMOTE'
set -euo pipefail
bind="$1" port="$2" user="$3" reset="$4" host_ip="$5"
if ! command -v dockerd >/dev/null; then
  echo "    installing Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | LC_ALL=C.UTF-8 sh >/tmp/get-docker.log 2>&1 ||
    { cat /tmp/get-docker.log >&2; exit 1; }
  usermod -aG docker "$user"
fi
if [[ "$reset" == 1 ]]; then
  systemctl stop docker.socket docker containerd
  rm -rf /var/lib/docker /var/lib/containerd
  systemctl reset-failed docker 2>/dev/null || true
  systemctl start containerd docker
  echo "    Docker emptied (containers, volumes, networks, images)"
fi
# Writes the file when its content differs; returns 0 when it did
write_if_changed() {
  [[ "$(cat "$1" 2>/dev/null)" == "${2%$'\n'}" ]] && return 1
  mkdir -p "$(dirname "$1")"
  printf '%s' "$2" > "$1"
}

# host.docker.internal: the dummy interface goes at each boot, so it is made
# again, and resolved restarted to listen on it
if ! ip link show tartlab0 >/dev/null 2>&1; then
  ip link add tartlab0 type dummy
  ip link set tartlab0 up
  ip addr add "$host_ip/32" dev tartlab0
  systemctl restart systemd-resolved
fi
grep -q "^$host_ip host.docker.internal" /etc/hosts ||
  echo "$host_ip host.docker.internal # tart-lab" >> /etc/hosts
if write_if_changed /etc/systemd/resolved.conf.d/tart-lab.conf "[Resolve]
DNSStubListenerExtra=$host_ip
"; then
  systemctl restart systemd-resolved
fi
# sshd may listen on 192.0.2.1 for the agent's tunnel (-R)
if write_if_changed /etc/ssh/sshd_config.d/tart-lab.conf "GatewayPorts clientspecified
"; then
  systemctl reload ssh 2>/dev/null || systemctl restart ssh
fi

# The empty ExecStart= clears the unit's own; -H fd:// keeps the socket that
# systemd hands over. A "hosts" key in daemon.json would conflict with -H.
file=/etc/systemd/system/docker.service.d/override.conf
changed=0
write_if_changed "$file" "[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://$bind:$port --containerd=/run/containerd/containerd.sock
" && changed=1
# Containers ask Docker's DNS, which asks resolved on 192.0.2.1
write_if_changed /etc/docker/daemon.json "{ \"dns\": [\"$host_ip\"] }
" && changed=1
if ((changed)); then
  systemctl daemon-reload
  systemctl restart docker || true
  echo "    wrote Docker's settings and restarted it"
else
  systemctl is-active --quiet docker || systemctl start docker || true
fi
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$port/_ping" >/dev/null 2>&1 && exit 0
  sleep 1
done
echo "dockerd does not answer on port $port: see journalctl -u docker. A corrupted database is fixed by a reset: tart-lab.sh down, then up." >&2
exit 1
REMOTE
}

# Mounts the shared folder at local-env's home path. A folder already there
# was made by Docker, for bind mounts that found nothing: it is moved aside,
# with the containers that use it.
mount_linux_home() {
  local ip="$1"
  vm_ssh "$ip" sudo bash -s -- "$SHARE_TAG" "$LAB_HOME" <<'REMOTE'
set -euo pipefail
tag="$1" dir="$2"
if mountpoint -q "$dir"; then exit 0; fi
if [[ -d "$dir" && -n "$(ls -A "$dir")" ]]; then
  ids="$(docker ps -aq --filter label=com.docker.compose.project=local-env)"
  # shellcheck disable=SC2086
  [[ -z "$ids" ]] || docker rm -f $ids >/dev/null
  mv "$dir" "$dir.before-tart-lab.$(date +%s)"
  echo "    moved the old $dir aside and removed the core stack's containers"
fi
mkdir -p "$dir"
mount -t virtiofs "$tag" "$dir"
REMOTE
}

# --- macos: client --------------------------------------------------------------

docker_host_url() { printf 'tcp://%s:%s' "$1" "$TUNNEL_PORT"; }

# Writes DOCKER_HOST into ~/.zshenv of the macOS VM (every zsh reads it),
# replacing the line an earlier run wrote.
configure_mac_docker() {
  local ip="$1" url="$2"
  vm_ssh "$ip" bash -s -- "$url" <<'REMOTE'
set -euo pipefail
line="export DOCKER_HOST=\"$1\" # tart-lab"
file="$HOME/.zshenv"
touch "$file"
if ! grep -qxF "$line" "$file"; then
  grep -v ' # tart-lab$' "$file" > "$file.tmp" || true
  printf '%s\n' "$line" >> "$file.tmp"
  mv "$file.tmp" "$file"
fi
REMOTE
}

# Mounts the shared folder at ~/.local-env. A home the VM had before is moved
# aside and copied in, when the shared folder is still empty.
mount_mac_home() {
  local ip="$1"
  vm_ssh "$ip" bash -s -- "$SHARE_TAG" "$LAB_HOME" <<'REMOTE'
set -euo pipefail
tag="$1" dir="$2"
# A mount point is its own last column in df
if [[ -d "$dir" && "$(df -P "$dir" | awk 'NR == 2 { print $NF }')" == "$dir" ]]; then exit 0; fi
backup=''
if [[ -d "$dir" && -n "$(ls -A "$dir")" ]]; then
  backup="$dir.before-tart-lab.$(date +%s)"
  mv "$dir" "$backup"
fi
mkdir -p "$dir"
mount_virtiofs "$tag" "$dir"
if [[ -n "$backup" ]]; then
  if [[ -z "$(ls -A "$dir")" ]]; then
    # -X: the shared folder takes no extended attributes; no -p: nor the
    # times of its root
    cp -RX "$backup/." "$dir/" || echo "    some files were not copied: see above"
    echo "    copied the VM's local-env home into the shared folder ($backup is the old one)"
  else
    echo "    the shared folder already has a home: $backup is the VM's old one"
  fi
fi
REMOTE
}

# Ports below 1024 arrive on 20000 + port in the macOS VM (see the header).
mac_port() { if (($1 < 1024)); then echo $((20000 + $1)); else echo "$1"; fi; }

# The pf rules that redirect 127.0.0.1:80 and :443 of the macOS VM to the
# forwarded high ports. The default pf.conf loads the com.apple/* anchors.
configure_mac_pf() {
  local ip="$1" port rules=''
  for port in $FORWARD_PORTS; do
    ((port < 1024)) || continue
    rules+="rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port $port -> 127.0.0.1 port $(mac_port "$port")"$'\n'
  done
  [[ -n "$rules" ]] || return 0
  printf '%s' "$rules" | vm_ssh "$ip" "sudo -n pfctl -a $PF_ANCHOR -f - 2>/dev/null && { sudo -n pfctl -s info 2>/dev/null | grep -q 'Status: Enabled' || sudo -n pfctl -E >/dev/null 2>&1; }" ||
    die "could not set the pf rules in the macOS VM ($VM_USER needs sudo without a password)."
}

# --- host bridge: ssh tunnels ---------------------------------------------------

# The gateway of Tart's network: the host's address on the VMs' subnet. The
# bridge interface exists once a VM runs.
host_gateway() {
  local ip="$1" prefix
  prefix="${ip%.*}"
  if ifconfig 2>/dev/null | grep -q "inet $prefix\.1 "; then
    printf '%s.1\n' "$prefix"
  else
    die "the host has no address on $prefix.0/24: set TUNNEL_BIND."
  fi
}

# Each tunnel is one ssh process, tagged `-o Tag=tart-lab-<name>`, so it can
# be found again without its PID file. Its .spec file holds its arguments: a
# tunnel whose arguments changed (a new IP) is restarted.
tunnel_pid() {
  local name="$1" pid
  pid="$(cat "$STATE_DIR/tunnel-$name.pid" 2>/dev/null)" || return 1
  # The PID must still be our ssh, not a reused number.
  ps -p "$pid" -o command= 2>/dev/null | grep -qF "Tag=tart-lab-$name" || return 1
  printf '%s\n' "$pid"
}

stop_tunnel() {
  local name="$1" pids
  pids="$( (tunnel_pid "$name" || true; pgrep -f "Tag=tart-lab-$name( |\$)" || true) | sort -u)"
  rm -f "$STATE_DIR/tunnel-$name.pid" "$STATE_DIR/tunnel-$name.spec"
  [[ -n "$pids" ]] || return 1
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
}

# start_tunnel <name> <ip> <forward options...>
start_tunnel() {
  local name="$1" ip="$2" pid
  shift 2
  local spec="$ip $*"
  if pid="$(tunnel_pid "$name")" &&
    [[ "$(cat "$STATE_DIR/tunnel-$name.spec" 2>/dev/null)" == "$spec" ]]; then
    ok "$name tunnel already running (pid $pid)"
    return
  fi
  stop_tunnel "$name" || true
  # -N: no command, forwarding only. ExitOnForwardFailure: exit when a port
  # can't be bound, instead of running without it. ServerAlive*: exit when
  # the VM goes away, so `status` sees a dead tunnel. StreamLocalBindUnlink:
  # replace the socket file an earlier run left.
  nohup ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o StreamLocalBindUnlink=yes -o "Tag=tart-lab-$name" -i "$SSH_KEY" -N \
    "$@" "$VM_USER@$ip" >"$STATE_DIR/tunnel-$name.log" 2>&1 </dev/null &
  pid=$!
  disown
  printf '%s\n' "$pid" >"$STATE_DIR/tunnel-$name.pid"
  printf '%s\n' "$spec" >"$STATE_DIR/tunnel-$name.spec"
  sleep 1
  tunnel_pid "$name" >/dev/null || {
    cat "$STATE_DIR/tunnel-$name.log" >&2
    die "the $name tunnel exited."
  }
  ok "$name tunnel started (pid $pid)"
}

start_docker_tunnel() {
  local ip="$1" bind="$2"
  if ! tunnel_pid docker >/dev/null && nc -z -G 1 "$bind" "$TUNNEL_PORT" >/dev/null 2>&1; then
    die "$bind:$TUNNEL_PORT is in use by another process: lsof -nP -iTCP:$TUNNEL_PORT -sTCP:LISTEN"
  fi
  start_tunnel docker "$ip" -L "$bind:$TUNNEL_PORT:localhost:$DOCKER_TCP_PORT"
}

# Checks the Docker tunnel from the host: the port is open, then Docker
# answers through it (GET /_ping returns OK).
health_check() {
  local bind="$1" deadline=$((SECONDS + 20)) addr
  addr="$bind"
  [[ "$addr" == 0.0.0.0 ]] && addr=127.0.0.1
  while ((SECONDS < deadline)); do
    if nc -z -G 1 "$addr" "$TUNNEL_PORT" >/dev/null 2>&1 &&
      [[ "$(curl -fsS -m 3 "http://$addr:$TUNNEL_PORT/_ping" 2>/dev/null)" == OK ]]; then
      ok "Docker answers through the tunnel at $addr:$TUNNEL_PORT"
      return 0
    fi
    tunnel_pid docker >/dev/null || die "the docker tunnel exited: see $STATE_DIR/tunnel-docker.log"
    sleep 1
  done
  die "Docker does not answer at $addr:$TUNNEL_PORT: see $STATE_DIR/tunnel-docker.log"
}

# Host socket -> port in the Linux VM, for each forwarded port
start_linux_ports_tunnel() {
  local ip="$1" port args=()
  for port in $FORWARD_PORTS; do
    args+=(-L "$SOCK_DIR/$port.sock:127.0.0.1:$port")
  done
  # The dashboard agent, the other way: 192.0.2.1 in the Linux VM -> socket
  args+=(-R "$LAB_HOST_IP:$AGENT_PORT:$SOCK_DIR/agent.sock")
  start_tunnel linux-ports "$ip" "${args[@]}"
}

# Port on the macOS VM's 127.0.0.1 -> host socket, for each forwarded port
start_mac_ports_tunnel() {
  local ip="$1" port args=()
  for port in $FORWARD_PORTS; do
    args+=(-R "127.0.0.1:$(mac_port "$port"):$SOCK_DIR/$port.sock")
  done
  # Socket -> the dashboard agent on the macOS VM's 127.0.0.1
  args+=(-L "$SOCK_DIR/agent.sock:127.0.0.1:$AGENT_PORT")
  start_tunnel mac-ports "$ip" "${args[@]}"
}

# --- commands -------------------------------------------------------------------

cmd_up() {
  check_prerequisites
  ensure_ssh_key

  step "Base VMs"
  ensure_vm "$LINUX_VM_NAME" "$LINUX_BASE_IMAGE"
  ensure_vm "$MAC_OS_VM_NAME" "$MAC_OS_BASE_IMAGE"

  step "A. Linux VM ($LINUX_VM_NAME)"
  start_vm "$LINUX_VM_NAME" 0

  step "B. Waiting for its IP and SSH"
  local linux_ip
  linux_ip="$(wait_for_vm "$LINUX_VM_NAME")"
  ok "$LINUX_VM_NAME is at $linux_ip"
  authorize_key "$linux_ip" "$LINUX_VM_NAME"

  step "C. Docker on TCP $DOCKER_TCP_BIND:$DOCKER_TCP_PORT, shared home"
  local reset=0
  [[ -f "$STATE_DIR/docker-reset" ]] && reset=1
  configure_docker "$linux_ip" "$reset"
  rm -f "$STATE_DIR/docker-reset"
  ok "dockerd listens on $DOCKER_TCP_BIND:$DOCKER_TCP_PORT"
  mount_linux_home "$linux_ip"
  ok "$LAB_HOME is the shared folder"

  step "D. Tunnels on the host"
  local bind="${TUNNEL_BIND:-$(host_gateway "$linux_ip")}"
  local gateway="$bind"
  [[ "$bind" == 0.0.0.0 ]] && gateway="$(host_gateway "$linux_ip")"
  start_docker_tunnel "$linux_ip" "$bind"
  health_check "$bind"
  start_linux_ports_tunnel "$linux_ip"
  local url
  url="$(docker_host_url "$gateway")"

  step "E. macOS VM ($MAC_OS_VM_NAME)"
  start_vm "$MAC_OS_VM_NAME" "$MAC_OS_GRAPHICS"
  local mac_ip
  mac_ip="$(wait_for_vm "$MAC_OS_VM_NAME")"
  ok "$MAC_OS_VM_NAME is at $mac_ip"
  authorize_key "$mac_ip" "$MAC_OS_VM_NAME"
  configure_mac_docker "$mac_ip" "$url"
  ok "DOCKER_HOST is in ~/.zshenv"
  mount_mac_home "$mac_ip"
  ok "$LAB_HOME is the shared folder"
  configure_mac_pf "$mac_ip"
  start_mac_ports_tunnel "$mac_ip"
  ok "127.0.0.1 ports ${FORWARD_PORTS// /, } reach the Linux VM"
  ok "the dashboard reaches the agent (host.docker.internal:$AGENT_PORT)"

  step "F. Ready"
  info "In the macOS VM, run the onboarding script: Docker is set up for it."
  info "${DIM}DOCKER_HOST=$url is in ~/.zshenv: a terminal opened before this run lacks it, open a new one.${RESET}"
  info "Shell: $0 ssh mac   |   Stop and reset: $0 down"
}

cmd_down() {
  local keep=0 clean=0 purge=0 arg
  for arg in "$@"; do
    case "$arg" in
      --keep) keep=1 ;;
      --clean) clean=1 ;;
      --purge) clean=1 purge=1 ;;
      *) die "unknown option: $arg" ;;
    esac
  done
  command -v tart >/dev/null || die 'tart is not installed.'

  step "Tunnels"
  local name
  for name in "${TUNNELS[@]}"; do
    if stop_tunnel "$name"; then ok "$name tunnel stopped"; else ok "no $name tunnel"; fi
  done
  rm -f "$SOCK_DIR"/*.sock

  step "VMs"
  for name in "$MAC_OS_VM_NAME" "$LINUX_VM_NAME"; do
    if vm_alive "$name"; then
      # tart stop shuts the guest down, and forces it after the timeout.
      stop_vm "$name"
      ok "$name stopped"
    else
      ok "$name is not running"
    fi
  done

  if ((!keep && !purge)); then
    step "Reset"
    name="$MAC_OS_VM_NAME"
    if [[ -f "$STATE_DIR/$name.cloned" ]] && vm_exists "$name"; then
      tart delete "$name"
      rm -f "$STATE_DIR/$name.cloned"
      ok "$name deleted: up clones a new one from $MAC_OS_BASE_IMAGE"
    elif vm_exists "$name"; then
      warn "$name was not cloned by this script: kept. Delete it (tart delete $name) for a fresh one."
    fi
    if [[ -d "$STATE_DIR" ]]; then
      rm -rf "$SHARE_DIR"
      touch "$STATE_DIR/docker-reset"
      ok "local-env home emptied; up empties the Linux VM's Docker"
    fi
  fi

  if ((purge)); then
    step "Deleting the VMs"
    for name in "$MAC_OS_VM_NAME" "$LINUX_VM_NAME"; do
      if vm_exists "$name"; then
        tart delete "$name"
        ok "$name deleted"
      fi
    done
  fi
  if ((clean)); then
    step "State"
    rm -rf "$STATE_DIR"
    ok "removed $STATE_DIR"
  fi
}

cmd_status() {
  command -v tart >/dev/null || die 'tart is not installed.'
  local name ip pid
  for name in "$LINUX_VM_NAME" "$MAC_OS_VM_NAME"; do
    if ! vm_exists "$name"; then
      info "$name: does not exist"
    elif vm_alive "$name"; then
      ip="$(tart ip "$name" 2>/dev/null || echo 'no IP yet')"
      info "$name: ${GREEN}running${RESET} ($ip)"
    else
      info "$name: stopped"
    fi
  done
  for name in "${TUNNELS[@]}"; do
    if pid="$(tunnel_pid "$name")"; then
      info "$name tunnel: ${GREEN}running${RESET} (pid $pid)"
    else
      info "$name tunnel: not running"
    fi
  done
  if pid="$(tunnel_pid docker)"; then
    local bind
    bind="$(ps -p "$pid" -o command= | sed -E 's/.*-L ([^:]*):.*/\1/')"
    [[ "$bind" == 0.0.0.0 ]] && bind=127.0.0.1
    if [[ "$(curl -fsS -m 3 "http://$bind:$TUNNEL_PORT/_ping" 2>/dev/null)" == OK ]]; then
      info "docker: ${GREEN}answers${RESET} at $(docker_host_url "$bind")"
    else
      info "docker: ${RED}no answer${RESET} at $(docker_host_url "$bind")"
    fi
  fi
}

cmd_env() {
  local ip
  ip="$(tart ip "$LINUX_VM_NAME" 2>/dev/null)" || die "$LINUX_VM_NAME is not running: $0 up"
  printf 'export DOCKER_HOST="%s"\n' "$(docker_host_url "${TUNNEL_BIND:-$(host_gateway "$ip")}")"
}

cmd_ssh() {
  local name
  case "${1:-}" in
    linux) name="$LINUX_VM_NAME" ;;
    mac) name="$MAC_OS_VM_NAME" ;;
    *) die 'usage: ssh linux|mac' ;;
  esac
  shift
  [[ -f "$SSH_KEY" ]] || die "no key yet: $0 up"
  local ip
  ip="$(tart ip "$name" 2>/dev/null)" || die "$name is not running."
  exec ssh "${SSH_OPTS[@]}" -i "$SSH_KEY" "$VM_USER@$ip" "$@"
}

usage() { sed -n '2,/^$/{s/^# \{0,1\}//;p;}' "$0"; }

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    up) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    status) cmd_status ;;
    env) cmd_env ;;
    ssh) cmd_ssh "$@" ;;
    help | -h | --help) usage ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
