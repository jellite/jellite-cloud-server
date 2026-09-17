import express from 'express';
import { Server as SsdpServer } from 'node-ssdp';
import { handleContentDirectoryControl } from './contentDirectory';
import http from 'http';
import https from 'https';

export async function startUpnpServer(host: string, port: number, backendUrl: string, apiKey: string, userId: string) {
    const app = express();
    app.use(express.text({ type: 'text/xml' }));
    app.use((req, res, next) => {
        next();
        console.log(`[debug] <- ${req.method} ${req.originalUrl} headers=${JSON.stringify(req.headers)}, status=${res.statusCode}`);
    });

    // Handle UPnP GENA event subscriptions (required by strict DLNA players)
    app.use((req, res, next) => {
        if (req.method === 'SUBSCRIBE') {
            res.set({
                'SID': 'uuid:11111111-2222-3333-4444-555555555555',
                'TIMEOUT': req.headers.timeout || 'Second-3600'
            });
            return res.status(200).end();
        }
        if (req.method === 'UNSUBSCRIBE') {
            return res.status(200).end();
        }
        next();
    });

    app.use(express.text({ type: 'text/xml' }));

    // 1. UPnP Device descriptor endpoint
    app.get('/device.xml', (req, res) => {
        const deviceXml = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>Jellite Cloud DLNA</friendlyName>
    <manufacturer>Jellite</manufacturer>
    <modelName>Jellite Media Server</modelName>
    <UDN>uuid:5f9ec1b3-ed59-1979-4530-00d02d33364e</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <controlURL>/ContentDirectory/control</controlURL>
        <eventSubURL>/ContentDirectory/event</eventSubURL>
        <SCPDURL>/ContentDirectory.xml</SCPDURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <controlURL>/ConnectionManager/control</controlURL>
        <eventSubURL>/ConnectionManager/event</eventSubURL>
        <SCPDURL>/ConnectionManager.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
        res.type('application/xml').send(deviceXml);
    });

    // 1b. UPnP service definition endpoints (SCPD)
    app.get('/ContentDirectory.xml', (req, res) => {
        const scpdXml = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>GetSearchCapabilities</name>
      <argumentList>
        <argument>
          <name>SearchCaps</name>
          <direction>out</direction>
          <relatedStateVariable>SearchCapabilities</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
    <action>
      <name>GetSortCapabilities</name>
      <argumentList>
        <argument>
          <name>SortCaps</name>
          <direction>out</direction>
          <relatedStateVariable>SortCapabilities</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
    <action>
      <name>GetSystemUpdateID</name>
      <argumentList>
        <argument>
          <name>Id</name>
          <direction>out</direction>
          <relatedStateVariable>SystemUpdateID</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument>
          <name>ObjectID</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable>
        </argument>
        <argument>
          <name>BrowseFlag</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable>
        </argument>
        <argument>
          <name>Filter</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable>
        </argument>
        <argument>
          <name>StartingIndex</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable>
        </argument>
        <argument>
          <name>RequestedCount</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>SortCriteria</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable>
        </argument>
        <argument>
          <name>Result</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable>
        </argument>
        <argument>
          <name>NumberReturned</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>TotalMatches</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>UpdateID</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Filter</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_SortCriteria</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Index</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Count</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_UpdateID</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>SearchCapabilities</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>SortCapabilities</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="yes">
      <name>SystemUpdateID</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Result</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_ObjectID</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_BrowseFlag</name>
      <dataType>string</dataType>
      <allowedValueList>
        <allowedValue>BrowseMetadata</allowedValue>
        <allowedValue>BrowseDirectChildren</allowedValue>
      </allowedValueList>
    </stateVariable>
  </serviceStateTable>
</scpd>`;
        res.type('application/xml').send(scpdXml);
    });

    app.get('/ConnectionManager.xml', (req, res) => {
        const scpdXml = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>GetProtocolInfo</name>
      <argumentList>
        <argument>
          <name>Source</name>
          <direction>out</direction>
          <relatedStateVariable>SourceProtocolInfo</relatedStateVariable>
        </argument>
        <argument>
          <name>Sink</name>
          <direction>out</direction>
          <relatedStateVariable>SinkProtocolInfo</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
    <action>
      <name>GetCurrentConnectionIDs</name>
      <argumentList>
        <argument>
          <name>ConnectionIDs</name>
          <direction>out</direction>
          <relatedStateVariable>CurrentConnectionIDs</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes">
      <name>SourceProtocolInfo</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="yes">
      <name>SinkProtocolInfo</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="yes">
      <name>CurrentConnectionIDs</name>
      <dataType>string</dataType>
    </stateVariable>
  </serviceStateTable>
</scpd>`;
        res.type('application/xml').send(scpdXml);
    });

    // 2. SOAP control endpoints
    app.post('/ContentDirectory/control', async (req, res) => {
        await handleContentDirectoryControl(req, res, host, port, backendUrl, apiKey, userId);
    });

    app.post('/ConnectionManager/control', (req, res) => {
        const responseXml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetProtocolInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
      <Source>http-get:*:audio/mpeg:*,http-get:*:audio/flac:*</Source>
      <Sink></Sink>
    </u:GetProtocolInfoResponse>
  </s:Body>
</s:Envelope>`;
        res.type('text/xml').send(responseXml);
    });

    // 3. Authenticated audio stream proxy
    app.get('/stream/:filename', (req, res) => {
        const trackId = req.params.filename.split('.')[0];
        const targetUrl = `${backendUrl}/Audio/${trackId}/stream?api_key=${apiKey}&static=true`;

        const options: https.RequestOptions = {};
        if (req.headers.range) {
            options.headers = { Range: req.headers.range };
        }

        const client = targetUrl.startsWith('https:') ? https : http;
        client.get(targetUrl, options, (proxyRes) => {
            // Clean express defaults to send clean binary stream
            res.status(proxyRes.statusCode || 200);

            // Forward essential headers
            const contentLength = proxyRes.headers['content-length'];
            const contentType = proxyRes.headers['content-type'] || 'audio/mpeg';
            const acceptRanges = proxyRes.headers['accept-ranges'];
            const contentRange = proxyRes.headers['content-range'];

            if (contentLength) res.setHeader('Content-Length', contentLength);
            if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
            if (contentRange) res.setHeader('Content-Range', contentRange);

            res.setHeader('Content-Type', contentType);
            res.setHeader('transferMode.dlna.org', 'Streaming');

            proxyRes.pipe(res);
        }).on('error', (err) => {
            console.error('[HTTP Proxy] Backend connection error:', err);
            res.status(500).end();
        });
    });

    // 4. Image thumbnail proxy (requests JPEG format from backend)
    app.get('/image/:filename', (req, res) => {
        const trackId = req.params.filename.split('.')[0];
        const targetUrl = `${backendUrl}/Items/${trackId}/Images/Primary?api_key=${apiKey}&format=jpg`;

        const client = targetUrl.startsWith('https:') ? https : http;
        client.get(targetUrl, (proxyRes) => {
            if (proxyRes.statusCode !== 200) return res.status(404).end();

            res.status(200);

            // Forwarding Content-Length is critical for hardware players (e.g. Yamaha)
            if (proxyRes.headers['content-length']) {
                res.setHeader('Content-Length', proxyRes.headers['content-length']);
            }

            res.setHeader('Content-Type', 'image/jpeg');
            // DLNA thumbnail profile for small JPEG covers
            res.setHeader('transferMode.dlna.org', 'Streaming');
            res.setHeader('contentFeatures.dlna.org', 'DLNA.ORG_PN=JPEG_TN;DLNA.ORG_OP=00;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=00900000000000000000000000000000');

            proxyRes.pipe(res);
        }).on('error', (err) => {
            console.error('[HTTP Proxy] Image fetch error:', err);
            res.status(500).end();
        });
    });

    app.listen(port, '0.0.0.0', () => {
        console.log(`[UPnP] HTTP Server running on port ${port}`);

        const ssdpServer = new SsdpServer({
            location: `http://${host}:${port}/device.xml`,
            udn: 'uuid:5f9ec1b3-ed59-1979-4530-00d02d33364e'
        });

        ssdpServer.addUSN('upnp:rootdevice');
        ssdpServer.addUSN('urn:schemas-upnp-org:device:MediaServer:1');
        ssdpServer.addUSN('urn:schemas-upnp-org:service:ContentDirectory:1');
        ssdpServer.addUSN('urn:schemas-upnp-org:service:ConnectionManager:1');

        ssdpServer.start();
        console.log(`[UPnP] SSDP Broadcast started on ${host}:${port}`);
    });
}
