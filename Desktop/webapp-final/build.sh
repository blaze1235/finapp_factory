#!/bin/bash
# Run this locally before git push to build the React frontend.
# The built files land in /static/ which Railway serves via Flask.
set -e
cd frontend
npm install
npm run build
cd ..
echo "✅ Frontend built → static/"
