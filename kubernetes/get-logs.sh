kubectl get pods -l=app=berlioz-controller --no-headers | awk "{print \$1}" | while read -r podId; do
    echo "*******************************************************"
    echo "Getting Logs $podId..."
    kubectl logs $podId
    echo "*******************************************************"
done