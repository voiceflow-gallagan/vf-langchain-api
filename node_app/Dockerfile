# node_app/Dockerfile

# Use the official Node.js v18 base image
FROM node:18

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy the app source
COPY . .

# Expose the app port
EXPOSE 3000

# Start the app
CMD [ "npm", "start" ]
