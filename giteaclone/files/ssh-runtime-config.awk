BEGIN { section=""; servers=0 }
/^[[:space:]]*\[/ {
  section=tolower($0)
  if (section ~ /^\[server\][[:space:]]*$/) {
    servers++
    print "[server]"
    print "ROOT_URL = https://gitea.bowong.cc/"
    print "DOMAIN = gitea.bowong.cc"
    print "DISABLE_SSH = false"
    print "START_SSH_SERVER = true"
    print "BUILTIN_SSH_SERVER_USER = git"
    print "SSH_USER = git"
    print "SSH_DOMAIN = gitea.bowong.cc"
    print "SSH_PORT = 2222"
    print "SSH_LISTEN_HOST = 127.0.0.1"
    print "SSH_LISTEN_PORT = 2222"
    print "SSH_ROOT_PATH = /runtime/ssh"
    print "SSH_SERVER_HOST_KEYS = /runtime/ssh/gitea.rsa"
    print "SSH_CREATE_AUTHORIZED_KEYS_FILE = false"
    print "SSH_CREATE_AUTHORIZED_PRINCIPALS_FILE = false"
    next
  }
}
section ~ /^\[server\][[:space:]]*$/ {
  key=$0; sub(/=.*/, "", key); gsub(/[[:space:]]/, "", key); key=toupper(key)
  if (key ~ /^(ROOT_URL|DOMAIN|DISABLE_SSH|START_SSH_SERVER|BUILTIN_SSH_SERVER_USER|SSH_USER|SSH_DOMAIN|SSH_PORT|SSH_LISTEN_HOST|SSH_LISTEN_PORT|SSH_ROOT_PATH|SSH_SERVER_HOST_KEYS|SSH_CREATE_AUTHORIZED_KEYS_FILE|SSH_CREATE_AUTHORIZED_PRINCIPALS_FILE)$/) next
}
{ print }
END { if (servers != 1) exit 1 }
