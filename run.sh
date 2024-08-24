#!/bin/bash

# Check if at least one port is provided
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 port [port...]"
  exit 1
fi

# Iterate over each provided port
for port in "$@"; do
  echo "Checking port $port..."

  # Find the process ID (PID) using the given port
  pid=$(lsof -t -i :$port)

  if [ -n "$pid" ]; then
    echo "Killing process $pid on port $port..."
    # Kill the process
    kill -9 $pid
    echo "Process $pid on port $port killed."
  else
    echo "No process found on port $port."
  fi
done

echo "Done."
