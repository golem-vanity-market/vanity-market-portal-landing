set -x
bun install
bun run build
sudo cp -r dist/* /var/www/html/

