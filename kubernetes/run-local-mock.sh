MY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
MY_DIR="$(dirname $MY_PATH)"
echo "My Dir: $MY_DIR"
cd $MY_DIR

cd src/mock
node remote