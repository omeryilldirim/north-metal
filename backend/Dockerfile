FROM node:20

RUN apt-get update && apt-get install -y python3 python3-pip

WORKDIR /app

# önce dependency kopyala (cache için)
COPY package*.json ./
COPY requirements.txt ./

RUN npm install
RUN pip3 install -r requirements.txt

# sonra tüm kod
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
