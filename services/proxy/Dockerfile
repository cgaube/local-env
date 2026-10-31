FROM nginx:alpine

# Replaced by local-env.conf and the generated routes
RUN rm /etc/nginx/conf.d/default.conf
COPY config/local-env.conf /etc/nginx/conf.d/local-env.conf
