FROM alpine:3.20

RUN apk add --no-cache curl jq bash ca-certificates

COPY smoke.sh /smoke.sh
RUN chmod +x /smoke.sh

ENTRYPOINT ["/smoke.sh"]
CMD ["docker"]
