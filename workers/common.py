import ssl
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
from app.config import get_settings

def kafka_options():
    s=get_settings(); options={'bootstrap_servers':s.kafka_bootstrap_servers.split(','),'security_protocol':s.kafka_security_protocol}
    if s.kafka_security_protocol in ('SSL','SASL_SSL'):
        ctx=ssl.create_default_context(cafile=s.kafka_ca_file or None)
        if s.kafka_cert_file and s.kafka_key_file: ctx.load_cert_chain(s.kafka_cert_file,s.kafka_key_file)
        options['ssl_context']=ctx
    if s.kafka_security_protocol.startswith('SASL'):
        options.update(sasl_mechanism=s.kafka_sasl_mechanism,sasl_plain_username=s.kafka_username,sasl_plain_password=s.kafka_password)
    return options
