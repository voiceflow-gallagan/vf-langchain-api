#!/bin/bash

# Clone the Chroma repository if not already cloned
if [ ! -d "chroma" ]; then
  git clone https://github.com/chroma-core/chroma.git
fi

# Run Docker Compose
docker-compose up -d --build
