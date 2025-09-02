#!/bin/bash
# ------------------------------------------------------------------
# setup_network.sh
#
# This script configures a static IP on a chosen interface,
# sets the default gateway, sets the hostname, and configures DNS.
# 
# 1) Temporarily applies the IP settings (using 'ip' commands).
# 2) Optionally writes a netplan or NetworkManager config so the 
#    settings persist and appear in the GUI.
#
# ------------------------------------------------------------------

set -e

##############################################################################
# STEP 1: AUTO-DETECT INTERFACE OR PROMPT
##############################################################################
interfaces=$(ip -o link show | awk -F': ' '{print $2}' \
    | grep -v '^lo' \
    | grep -v '^docker' \
    | grep -v '^veth' \
    | grep -v '^wlp' \
    | grep -v '^br-')

count=$(echo "$interfaces" | wc -l)

if [ "$count" -eq 1 ]; then
    INTERFACE="$interfaces"
    echo "Auto-detected interface: $INTERFACE"
else
    echo "Multiple possible interfaces found: $interfaces"
    read -p "Enter the interface you want to configure [eth0]: " input_iface
    INTERFACE="${input_iface:-eth0}"
fi

echo ""
echo "Enter your own values or leave it blank and press Enter to use defaults."
echo ""

##############################################################################
# STEP 2: PROMPT FOR IP SETTINGS
##############################################################################
read -p "Enter Static IP for $INTERFACE or press Enter for [172.26.212.44]: " input_ip
JETSON_IP="${input_ip:-172.26.212.44}"

read -p "Enter Network Mask or press Enter for [255.255.255.0]: " input_netmask
NETMASK="${input_netmask:-255.255.255.0}"

read -p "Enter Default Gateway or press Enter for [172.26.212.254]: " input_gateway
GATEWAY="${input_gateway:-172.26.212.254}"

# Convert dotted-decimal netmask to CIDR
netmask_to_cidr() {
    local netmask=$1
    local IFS=.
    read -r o1 o2 o3 o4 <<< "$netmask"
    local binary=$(( (o1 << 24) + (o2 << 16) + (o3 << 8) + o4 ))
    local cidr=0
    while [ $binary -gt 0 ]; do
        cidr=$((cidr + (binary & 1) ))
        binary=$((binary >> 1))
    done
    echo "$cidr"
}

CIDR=$(netmask_to_cidr "$NETMASK")

read -p "Enter Hostname or press Enter for [ksskringdistance02]: " input_hostname
HOSTNAME="${input_hostname:-ksskringdistance02}"

read -p "Enter DNS Server or press Enter for [8.8.8.8]: " input_dns
DNS="${input_dns:-8.8.8.8}"

echo ""
echo "-------------------------------------------------"
echo "You entered:"
echo " - Interface: $INTERFACE"
echo " - IP: $JETSON_IP"
echo " - Netmask: $NETMASK (CIDR /$CIDR)"
echo " - Gateway: $GATEWAY"
echo " - Hostname: $HOSTNAME"
echo " - DNS: $DNS"
echo "-------------------------------------------------"
read -p "Press Enter to apply these settings (temporarily), or Ctrl+C to cancel..."


##############################################################################
# STEP 3: APPLY THE NETWORK CONFIG (EPHEMERAL)
##############################################################################
echo "Setting hostname to $HOSTNAME..."
sudo hostnamectl set-hostname "$HOSTNAME"

echo "Bringing down $INTERFACE..."
sudo ip link set "$INTERFACE" down

echo "Flushing existing IP addresses on $INTERFACE..."
sudo ip addr flush dev "$INTERFACE"

# Assign IP using CIDR
echo "Assigning static IP $JETSON_IP/$CIDR on $INTERFACE..."
sudo ip addr add "$JETSON_IP/$CIDR" dev "$INTERFACE"

echo "Bringing up $INTERFACE..."
sudo ip link set "$INTERFACE" up

# Remove any existing default route (ignore errors)
echo "Removing any existing default route..."
sudo ip route del default || true

# Add new default route
echo "Setting default gateway to $GATEWAY..."
if ! sudo ip route add default via "$GATEWAY" dev "$INTERFACE" 2>/tmp/route_error; then
    echo "Failed to set default route normally. Trying 'onlink'..."
    sudo ip route add default via "$GATEWAY" dev "$INTERFACE" onlink
fi

# DNS configuration
echo "Configuring DNS to use $DNS..."
echo "nameserver $DNS" | sudo tee /etc/resolv.conf > /dev/null

echo "-------------------------------------------------"
echo "Network configuration complete (TEMPORARY)."
echo " - Interface: $INTERFACE"
echo " - IP: $JETSON_IP/$CIDR"
echo " - Gateway: $GATEWAY"
echo " - Hostname: $HOSTNAME"
echo " - DNS: $DNS"
echo "-------------------------------------------------"
echo ""
echo "WARNING: These settings may be overridden on reboot or by NetworkManager/Netplan."
echo ""

##############################################################################
# STEP 4: ASK TO MAKE PERMANENT (NETPLAN OR NETWORKMANAGER)
##############################################################################
echo "Do you want to make these settings permanent so they appear in the GUI and survive reboots?"
echo "1) Yes, create a Netplan config (renderer: networkd)."
echo "2) Yes, create a NetworkManager connection (nmcli)."
echo "3) No, keep changes temporary."
read -p "Select an option (1/2/3): " choice

# --- Function to create netplan file ---
create_netplan() {
  # We create or overwrite /etc/netplan/99-setup_network.yaml
  # If your system already uses renderer: NetworkManager, this might conflict.
  echo "Writing netplan config to /etc/netplan/99-setup_network.yaml..."
  cat <<EOF | sudo tee /etc/netplan/99-setup_network.yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    $INTERFACE:
      addresses: [$JETSON_IP/$CIDR]
      gateway4: $GATEWAY
      nameservers:
        addresses: [$DNS]
EOF

  echo "Applying netplan config..."
  sudo netplan apply
  echo "Netplan configuration saved and applied. Settings should persist after reboot."
}

# --- Function to create a NetworkManager connection ---
create_nm_connection() {
  # If there's an existing connection on this interface, remove it
  existing_conn=$(nmcli -t -f NAME,DEVICE c show --active | grep ":$INTERFACE" | cut -d':' -f1)
  if [ -n "$existing_conn" ]; then
    echo "Disabling existing connection '$existing_conn' on interface '$INTERFACE'..."
    sudo nmcli con down "$existing_conn"
    sudo nmcli con delete "$existing_conn"
  fi

  echo "Creating a new NetworkManager connection named 'setup_network'..."
  sudo nmcli con add type ethernet ifname "$INTERFACE" con-name "setup_network" \
    ipv4.addresses "$JETSON_IP/$CIDR" \
    ipv4.gateway "$GATEWAY" \
    ipv4.dns "$DNS" \
    ipv4.method manual \
    autoconnect yes

  echo "Bringing up 'setup_network'..."
  sudo nmcli con up "setup_network"
  echo "NetworkManager configuration saved. It should now appear in the GUI and persist."
}

case "$choice" in
  1)
    create_netplan
    ;;
  2)
    # Make sure nmcli is installed
    if ! command -v nmcli &> /dev/null; then
      echo "nmcli not found. Install NetworkManager or choose netplan."
      exit 1
    fi
    create_nm_connection
    ;;
  3)
    echo "Leaving changes temporary. They will not persist after a reboot."
    ;;
  *)
    echo "Invalid choice. Leaving changes temporary."
    ;;
esac

echo ""
echo "Done."