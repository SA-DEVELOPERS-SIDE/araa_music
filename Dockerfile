# Use Node.js 20 base image
FROM node:20

# Install necessary dependencies (ffmpeg, python3-pip, curl)
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install yt-dlp (with --break-system-packages)
RUN pip3 install --break-system-packages --upgrade pip yt-dlp
RUN npm install -g npm@11.3.0

# Set working directory
WORKDIR /app

# Copy package.json and install Node dependencies
COPY package*.json ./
RUN npm install

# Copy app code
COPY . .

# Expose port
EXPOSE 5000

# Start app
CMD ["npm", "start"]
