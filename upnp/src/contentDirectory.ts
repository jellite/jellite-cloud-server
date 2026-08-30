import { Request, Response } from 'express';
import { create } from 'xmlbuilder2';

// Cache for track -> playlist relationship, so BrowseMetadata can return the correct parentID
const trackParentCache = new Map<string, string>();

async function fetchJellite(endpoint: string, backendUrl: string, apiKey: string) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${backendUrl}${endpoint}${separator}api_key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Jellite API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function getProtocolInfo(container: string | undefined): string {
    const c = (container || 'mp3').toLowerCase();
    if (c.includes('flac')) return 'http-get:*:audio/flac:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    if (c.includes('m4a') || c.includes('mp4') || c.includes('aac')) return 'http-get:*:audio/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    if (c.includes('wav')) return 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    return 'http-get:*:audio/mpeg:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
}

function buildTrackItem(didl: any, track: any, host: string, port: number, parentID: string) {
    const containerExt = (track.Container || 'mp3').toLowerCase();
    const trackUrl = `http://${host}:${port}/stream/${track.Id}.${containerExt}`;
    const imageUrl = `http://${host}:${port}/image/${track.Id}.jpg`;

    const item = didl.ele('item', { id: `track_${track.Id}`, parentID: parentID, restricted: '1' })
        .ele('dc:title').txt(track.Name || 'Unknown Track').up()
        .ele('upnp:class').txt('object.item.audioItem.musicTrack').up()
        .ele('res', { protocolInfo: getProtocolInfo(track.Container) }).txt(trackUrl).up();

    item.ele('upnp:albumArtURI', { 'dlna:profileID': 'JPEG_TN' }).txt(imageUrl).up();

    if (track.Album) item.ele('upnp:album').txt(track.Album).up();
    if (track.Artists && track.Artists.length > 0) item.ele('upnp:artist').txt(track.Artists[0]).up();
    if (track.IndexNumber) item.ele('upnp:originalTrackNumber').txt(track.IndexNumber.toString()).up();

    item.up();
}

export async function handleContentDirectoryControl(
    req: Request,
    res: Response,
    host: string,
    port: number,
    backendUrl: string,
    apiKey: string,
    userId: string
) {
    const soapAction = req.headers['soapaction'] as string;
    if (!soapAction) return res.status(400).send('Missing SOAP action');

    try {
        if (soapAction.includes('GetSortCapabilities')) {
            const responseXml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetSortCapabilitiesResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><SortCaps></SortCaps></u:GetSortCapabilitiesResponse></s:Body></s:Envelope>`;
            return res.type('text/xml').send(responseXml);
        }

        if (soapAction.includes('GetSearchCapabilities')) {
            const responseXml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetSearchCapabilitiesResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><SearchCaps></SearchCaps></u:GetSearchCapabilitiesResponse></s:Body></s:Envelope>`;
            return res.type('text/xml').send(responseXml);
        }

        if (soapAction.includes('GetSystemUpdateID')) {
            const responseXml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetSystemUpdateIDResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><Id>1</Id></u:GetSystemUpdateIDResponse></s:Body></s:Envelope>`;
            return res.type('text/xml').send(responseXml);
        }

        if (soapAction.includes('Browse')) {
            const objectIdMatch = req.body.match(/<ObjectID>(.*?)<\/ObjectID>/);
            const browseFlagMatch = req.body.match(/<BrowseFlag>(.*?)<\/BrowseFlag>/);
            const startingIndexMatch = req.body.match(/<StartingIndex>(.*?)<\/StartingIndex>/);
            const requestedCountMatch = req.body.match(/<RequestedCount>(.*?)<\/RequestedCount>/);

            const objectId = objectIdMatch ? objectIdMatch[1] : '0';
            const browseFlag = browseFlagMatch ? browseFlagMatch[1] : 'BrowseDirectChildren';
            const startIndex = startingIndexMatch ? parseInt(startingIndexMatch[1], 10) : 0;
            const requestedCount = requestedCountMatch ? parseInt(requestedCountMatch[1], 10) : 0;

            let totalMatches = 0;
            let numberReturned = 0;

            const didl = create({ version: '1.0', encoding: 'utf-8' })
                .ele('DIDL-Lite', {
                    'xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                    'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                    'xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                    'xmlns:dlna': 'urn:schemas-dlna-org:metadata-1-0/'
                });

            if (browseFlag === 'BrowseMetadata') {
                if (objectId === '0') {
                    didl.ele('container', { id: '0', parentID: '-1', restricted: '1', searchable: '0' })
                        .ele('dc:title').txt('Root').up()
                        .ele('upnp:class').txt('object.container').up()
                        .up();
                    totalMatches = 1;
                    numberReturned = 1;
                } else if (objectId.startsWith('track_')) {
                    const trackId = objectId.replace('track_', '');
                    let parentID = '0';

                    if (trackParentCache.has(trackId)) {
                        parentID = trackParentCache.get(trackId)!;
                    }

                    const track = await fetchJellite(`/Users/${userId}/Items/${trackId}`, backendUrl, apiKey);
                    buildTrackItem(didl, track, host, port, parentID);

                    totalMatches = 1;
                    numberReturned = 1;
                } else if (objectId.startsWith('playlist_')) {
                    const playlistId = objectId.replace('playlist_', '');
                    const playlist = await fetchJellite(`/Users/${userId}/Items/${playlistId}`, backendUrl, apiKey);

                    didl.ele('container', { id: objectId, parentID: '0', restricted: '1', searchable: '0' })
                        .ele('dc:title').txt(playlist.Name || 'Playlist').up()
                        .ele('upnp:class').txt('object.container.playlistContainer').up()
                        .up();
                    totalMatches = 1;
                    numberReturned = 1;
                }
            } else {
                // BrowseDirectChildren with pagination support
                const limitQuery = requestedCount > 0 ? `&Limit=${requestedCount}` : `&Limit=50`;
                const startQuery = `&StartIndex=${startIndex}`;

                if (objectId === '0') {
                    const data = await fetchJellite(`/Users/${userId}/Items?IncludeItemTypes=Playlist&Recursive=true${startQuery}${limitQuery}`, backendUrl, apiKey);
                    const playlists = data.Items || [];

                    totalMatches = data.TotalRecordCount !== undefined ? data.TotalRecordCount : playlists.length;
                    numberReturned = playlists.length;

                    for (const playlist of playlists) {
                        didl.ele('container', {
                            id: `playlist_${playlist.Id}`,
                            parentID: '0',
                            restricted: '1',
                            searchable: '0',
                            childCount: '1'
                        })
                            .ele('dc:title').txt(playlist.Name).up()
                            .ele('upnp:class').txt('object.container.playlistContainer').up()
                            .up();
                    }
                } else if (objectId.startsWith('playlist_')) {
                    const playlistId = objectId.replace('playlist_', '');
                    const data = await fetchJellite(`/Playlists/${playlistId}/Items?UserId=${userId}&Fields=MediaSources,Album,Artists${startQuery}${limitQuery}`, backendUrl, apiKey);
                    const tracks = data.Items || [];

                    totalMatches = data.TotalRecordCount !== undefined ? data.TotalRecordCount : tracks.length;
                    numberReturned = tracks.length;

                    for (const track of tracks) {
                        trackParentCache.set(track.Id, objectId);
                        buildTrackItem(didl, track, host, port, objectId);
                    }
                }
            }

            const didlString = didl.end({ headless: true });
            const escapedDidl = didlString.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

            const responseXml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><Result>${escapedDidl}</Result><NumberReturned>${numberReturned}</NumberReturned><TotalMatches>${totalMatches}</TotalMatches><UpdateID>1</UpdateID></u:BrowseResponse></s:Body></s:Envelope>`;
            return res.type('text/xml').send(responseXml);
        }

        return res.status(500).send('Unsupported SOAP action');
    } catch (error) {
        console.error('[UPnP] Error handling SOAP request:', error);
        return res.status(500).send('Internal Server Error');
    }
}
