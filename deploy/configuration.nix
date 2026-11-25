# NixOS system configuration for Hostinger KVM template + CSW-Arcade Web Server & Auto-Deploy
{ config, lib, pkgs, modulesPath, ... }:
{
  imports = [
    ./igraphr-telegram.nix
    "${modulesPath}/profiles/qemu-guest.nix"
  ];

  # GRUB Loader
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "/dev/sda";
  boot.loader.grub.efiSupport = false;
  boot.loader.timeout = 1;

  # Partition
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
    autoResize = true;
  };
  boot.growPartition = true;

  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" "earlyprintk=ttyS0,115200" "consoleblank=0" "memhp_default_state=online" ];

  services.qemuGuest.enable = true;

  # Cloud-init
  services.cloud-init.enable = true;
  services.cloud-init.network.enable = true;
  services.cloud-init.settings.datasource_list = [ "NoCloud" "ConfigDrive" ];
  services.cloud-init.settings.ssh.emit_keys_to_console = false;
  networking.useDHCP = lib.mkForce false;

  # System packages
  environment.systemPackages = with pkgs; [
    cloud-init
    dnsutils
    nettools
    curl
    wget
    nano
    git
    unzip
    nodejs
    rsync
    caddy
    coturn
  ];

  systemd.services.qemu-guest-agent.environment.PATH =
    lib.mkForce "/run/wrappers/bin:/run/current-system/sw/bin:/bin";

  # SSH
  services.openssh.enable = true;
  services.openssh.settings.PermitRootLogin = lib.mkDefault "yes";

  # Web Server Caddy (Auto-HTTPS pour csw-arcade.tech + Reverse Proxy + SPA)
  services.caddy = {
    enable = true;
    openFirewall = true;
    configFile = "/etc/caddy/Caddyfile";
  };

  # Serveur Relais WebRTC STUN/TURN ultra-rapide en UDP (CSW-Arcade Netplay)
  services.coturn = {
    enable = true;
    use-auth-secret = true;
    static-auth-secret-file = "/etc/coturn.secret";
    realm = "csw-arcade.tech";
    listening-port = 3478;
    min-port = 49152;
    max-port = 65535;
    no-cli = true;
    no-tcp-relay = false;
    extraConfig = ''
      external-ip=2.24.63.111
      fingerprint
      stale-nonce=600
      no-multicast-peers
      denied-peer-ip=0.0.0.0-0.255.255.255
      denied-peer-ip=10.0.0.0-10.255.255.255
      denied-peer-ip=127.0.0.0-127.255.255.255
      denied-peer-ip=169.254.0.0-169.254.255.255
      denied-peer-ip=172.16.0.0-172.31.255.255
      denied-peer-ip=192.168.0.0-192.168.255.255
    '';
  };

  # Service Webhook de Deploiement Continu Automatique GitHub
  systemd.services.csw-arcade-webhook = {
    description = "CSW-Arcade GitHub Auto-Deploy Webhook";
    after = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [ bash git nodejs systemd coreutils caddy ];
    serviceConfig = {
      Type = "simple";
      User = "root";
      WorkingDirectory = "/opt/csw-arcade";
      ExecStart = "${pkgs.nodejs}/bin/node /opt/csw-arcade/webhook-server.cjs";
      Restart = "always";
      RestartSec = 5;
    };
  };

  # Service Backend Netplay Hub & Salons Fightcade 2
  systemd.services.csw-arcade-backend = {
    description = "CSW-Arcade Netplay Hub & Lobby Backend";
    after = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [ nodejs ];
    environment = {
      PORT = "3003";
    };
    serviceConfig = {
      Type = "simple";
      User = "root";
      WorkingDirectory = "/opt/csw-arcade";
      EnvironmentFile = "/etc/csw-turn.env";
      ExecStart = "${pkgs.nodejs}/bin/node /opt/csw-arcade/src/server/standalone.js";
      Restart = "always";
      RestartSec = 5;
    };
  };

  # Firewall : Ports Web, Netplay & Relais UDP coturn
  networking.firewall.allowedTCPPorts = [ 80 443 3003 3478 ];
  networking.firewall.allowedUDPPorts = [ 3478 ];
  networking.firewall.allowedUDPPortRanges = [
    { from = 49152; to = 65535; }
  ];

  system.stateVersion = "26.05";
}
