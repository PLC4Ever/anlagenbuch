FROM node:20-alpine AS ui_schichtbuch
WORKDIR /src
COPY apps/ui-schichtbuch/package*.json ./
RUN npm install
COPY apps/ui-schichtbuch ./
RUN npm run build

FROM node:20-alpine AS ui_tickets
WORKDIR /src
COPY apps/ui-tickets/package*.json ./
RUN npm install
COPY apps/ui-tickets ./
RUN npm run build

FROM node:20-alpine AS ui_admin
WORKDIR /src
COPY apps/ui-admin/package*.json ./
RUN npm install
COPY apps/ui-admin ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY services/api/app /app/app
COPY --from=ui_schichtbuch /src/dist /app/static/ui-schichtbuch
COPY --from=ui_tickets /src/dist /app/static/ui-tickets
COPY --from=ui_admin /src/dist /app/static/ui-admin
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
