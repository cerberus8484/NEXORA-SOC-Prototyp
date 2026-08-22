-- Fortlaufende Ticket-Nummern im Format INC000001.
-- App liest nextval('ticket_number_seq') und formatiert mit Prefix INC + Padding.
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1;
