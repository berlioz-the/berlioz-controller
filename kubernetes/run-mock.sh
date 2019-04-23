MY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
MY_DIR="$(dirname $MY_PATH)"
echo "My Dir: $MY_DIR"
cd $MY_DIR

./publish.sh

kubectl apply -f mock/06_berlioz-controller.yaml

kubectl get pods -l=app=berlioz-controller --no-headers | grep -v Terminating | awk "{print \$1}" | while read -r podId; do
    echo "Deleting $podId..."
    kubectl delete pod $podId
done

echo "Sleeping ..."
sleep 3

./get-logs.sh