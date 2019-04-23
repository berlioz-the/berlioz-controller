MY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
MY_DIR="$(dirname $MY_PATH)"
echo "My Dir: $MY_DIR"
cd $MY_DIR

berlioz build --nocache
docker tag berlioz-k8s-controller berliozcloud/k8s-controller
docker push berliozcloud/k8s-controller