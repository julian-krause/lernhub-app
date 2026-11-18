// Brücke Oberfläche ↔ Hauptprozess. Die Oberfläche bekommt nur diese Funktionen, kein Node.
const { contextBridge, ipcRenderer } = require('electron');

const hoeren = (kanal) => (fn) => {
  const h = (e, wert) => fn(wert);
  ipcRenderer.on(kanal, h);
  return () => ipcRenderer.removeListener(kanal, h);
};

contextBridge.exposeInMainWorld('lernhub', {
  daten: () => ipcRenderer.invoke('daten:laden'),
  luecken: (ws) => ipcRenderer.invoke('kurs:luecken', ws),
  aktion: (url) => ipcRenderer.invoke('aktion', url),
  oeffnen: (p) => ipcRenderer.invoke('datei:oeffnen', p),
  uebenUebersicht: () => ipcRenderer.invoke('ueben:uebersicht'),
  uebenStand: (key) => ipcRenderer.invoke('ueben:stand', key),
  uebenStarten: (key) => ipcRenderer.invoke('ueben:starten', key),
  uebenSenden: (key, art, text) => ipcRenderer.invoke('ueben:senden', { key, art, text }),
  uebenVerwerfen: (key) => ipcRenderer.invoke('ueben:verwerfen', key),
  uebenNochmal: (key) => ipcRenderer.invoke('ueben:nochmal', key),
  uebenBeenden: (key) => ipcRenderer.invoke('ueben:beenden', key),
  lernenUebersicht: () => ipcRenderer.invoke('lernen:uebersicht'),
  lernenStand: (key) => ipcRenderer.invoke('lernen:stand', key),
  lernenStarten: (key) => ipcRenderer.invoke('lernen:starten', key),
  lernenSenden: (key, art, x) => ipcRenderer.invoke('lernen:senden', { key, art, x }),
  lernenNochmal: (key) => ipcRenderer.invoke('lernen:nochmal', key),
  lernenBeenden: (key) => ipcRenderer.invoke('lernen:beenden', key),
  lernenEintragen: (key) => ipcRenderer.invoke('lernen:eintragen', key),
  syncStand: () => ipcRenderer.invoke('sync:stand'),
  syncStarten: () => ipcRenderer.invoke('sync:starten'),
  syncAbbrechen: () => ipcRenderer.invoke('sync:abbrechen'),
  syncLeeren: () => ipcRenderer.invoke('sync:leeren'),
  info: () => ipcRenderer.invoke('info'),
  einstellungen: (mitSicher) => ipcRenderer.invoke('einstellungen', !!mitSicher),
  schluesselSetzen: (w) => ipcRenderer.invoke('schluessel:setzen', w),
  schluesselTesten: () => ipcRenderer.invoke('schluessel:testen'),
  schluesselLoeschen: () => ipcRenderer.invoke('schluessel:loeschen'),
  diktatStart: () => ipcRenderer.invoke('diktat:start'),
  diktatTon: (buf) => ipcRenderer.send('diktat:ton', buf),
  diktatStopp: () => ipcRenderer.invoke('diktat:stopp'),
  on: {
    datenGeaendert: hoeren('daten:geaendert'),
    fokus: hoeren('fenster:fokus'),
    meldung: hoeren('meldung'),
    nav: hoeren('nav'),
    navKursNr: hoeren('nav:kursNr'),
    navRoadmap: hoeren('nav:roadmap'),
    suche: hoeren('suche'),
    befehl: hoeren('befehl'),
    icloud: hoeren('icloud'),
    ueben: hoeren('ueben'),
    lernen: hoeren('lernen'),
    sync: hoeren('sync'),
    diktatStatus: hoeren('diktat:status'),
    diktatText: hoeren('diktat:text'),
  },
});
