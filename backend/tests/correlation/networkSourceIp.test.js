'use strict';

const { extractNetworkSourceIp, extractHoneypotAttackerIp, extractSensorIp } = require('../../src/correlation/networkSourceIp');

describe('extractNetworkSourceIp — echte Netzwerkquelle (nicht automatisch Angreifer)', () => {
  test('Cowrie data.src_ip', () => {
    expect(extractNetworkSourceIp({ data: { src_ip: '185.220.101.45' } })).toBe('185.220.101.45');
  });
  test('Firewall data.srcip', () => {
    expect(extractNetworkSourceIp({ data: { srcip: '192.168.240.109' } })).toBe('192.168.240.109');
  });
  test('Sysmon win.eventdata.sourceIp', () => {
    expect(extractNetworkSourceIp({ data: { win: { eventdata: { sourceIp: '10.99.99.10' } } } })).toBe('10.99.99.10');
  });
  test('Cowrie src_ip hat Vorrang vor Firewall-srcip', () => {
    expect(extractNetworkSourceIp({ data: { src_ip: '1.1.1.1', srcip: '2.2.2.2' } })).toBe('1.1.1.1');
  });
  test('agent.ip ist NIE die Quelle → null', () => {
    expect(extractNetworkSourceIp({ data: {}, agent: { ip: '10.99.99.80' } })).toBeNull();
  });
  test('nichts Belastbares → null', () => {
    expect(extractNetworkSourceIp({ data: {} })).toBeNull();
    expect(extractNetworkSourceIp({})).toBeNull();
    expect(extractNetworkSourceIp({ data: { src_ip: '   ' } })).toBeNull();
  });
});

describe('extractHoneypotAttackerIp — ausschließlich Cowrie src_ip', () => {
  test('Cowrie src_ip = Angreifer', () => {
    expect(extractHoneypotAttackerIp({ data: { src_ip: '185.220.101.45' } })).toBe('185.220.101.45');
  });
  test('Firewall srcip ist KEIN Honeypot-Angreifer → null', () => {
    expect(extractHoneypotAttackerIp({ data: { srcip: '192.168.240.109' } })).toBeNull();
  });
  test('Sysmon sourceIp → null', () => {
    expect(extractHoneypotAttackerIp({ data: { win: { eventdata: { sourceIp: '10.99.99.10' } } } })).toBeNull();
  });
  test('agent.ip → null', () => {
    expect(extractHoneypotAttackerIp({ data: {}, agent: { ip: '10.99.99.80' } })).toBeNull();
  });
});

describe('extractSensorIp — „wer hat gemeldet" (Host-/Sensor-Kontext)', () => {
  test('agent.ip', () => {
    expect(extractSensorIp({ agent: { ip: '10.99.99.80' } })).toBe('10.99.99.80');
  });
  test('ohne agent → null', () => {
    expect(extractSensorIp({})).toBeNull();
  });
});
