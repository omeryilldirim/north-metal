FROM node:20

RUN apt-get update && apt-get install -y python3 python3-pip python3-venv

WORKDIR /app

COPY package*.json ./
COPY requirements.txt ./

# node install
RUN npm install

# python venv oluştur
RUN python3 -m venv /opt/venv

# venv aktif et
ENV PATH="/opt/venv/bin:$PATH"

# python paketleri
RUN pip install -r requirements.txt

# sonra tüm kod
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]