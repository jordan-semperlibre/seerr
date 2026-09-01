import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { AxiosInstance } from 'axios';

import SonarrAPI, {
  type AddSeriesOptions,
  type SonarrSeries,
} from '@server/api/servarr/sonarr';
import {
  SONARR_MONITOR_TYPES,
  type SonarrMonitorType,
} from '@server/constants/sonarr';

function buildSonarr(): SonarrAPI {
  return new SonarrAPI({ url: 'http://localhost:8989/api/v3', apiKey: 'test' });
}

function getAxios(sonarr: SonarrAPI): AxiosInstance {
  return (sonarr as unknown as { axios: AxiosInstance }).axios;
}

function buildAddSeriesOptions(
  overrides: Partial<AddSeriesOptions> = {}
): AddSeriesOptions {
  return {
    tvdbid: 1234,
    title: 'Test Series',
    profileId: 1,
    seasons: [1],
    seasonFolder: true,
    rootFolderPath: '/tv',
    seriesType: 'standard',
    monitored: true,
    monitorNewItems: 'none',
    searchNow: true,
    ...overrides,
  };
}

function buildLookupSeries(): SonarrSeries {
  return {
    title: 'Test Series',
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
  } as SonarrSeries;
}

describe('SonarrAPI addSeries', () => {
  afterEach(() => mock.restoreAll());

  async function getCreatePayload(monitorNewSeries?: SonarrMonitorType) {
    const sonarr = buildSonarr();
    mock.method(
      SonarrAPI.prototype,
      'getSeriesByTvdbId',
      async () => buildLookupSeries()
    );
    const post = mock.method(getAxios(sonarr), 'post', async () => ({
      data: { id: 9, title: 'Test Series' },
    }));

    await sonarr.addSeries(buildAddSeriesOptions({ monitorNewSeries }));

    return post.mock.calls[0].arguments[1] as Partial<SonarrSeries>;
  }

  for (const monitorType of SONARR_MONITOR_TYPES) {
    it(`sends the ${monitorType} monitor type when creating a series`, async () => {
      const payload = await getCreatePayload(monitorType);

      assert.strictEqual(payload.addOptions?.monitor, monitorType);
    });
  }

  it('omits the monitor type when using requested seasons', async () => {
    const payload = await getCreatePayload();

    assert.ok(payload.addOptions);
    assert.strictEqual(
      Object.hasOwn(payload.addOptions, 'monitor'),
      false
    );
  });

  it('does not apply the monitor type when updating an existing series', async () => {
    const sonarr = buildSonarr();
    const existingSeries = { ...buildLookupSeries(), id: 9 };
    mock.method(
      SonarrAPI.prototype,
      'getSeriesByTvdbId',
      async () => existingSeries
    );
    mock.method(SonarrAPI.prototype, 'getEpisodes', async () => []);
    const put = mock.method(getAxios(sonarr), 'put', async () => ({
      data: existingSeries,
    }));
    const post = mock.method(getAxios(sonarr), 'post', async () => ({
      data: {},
    }));

    await sonarr.addSeries(
      buildAddSeriesOptions({
        monitorNewSeries: 'pilot',
        searchNow: false,
      })
    );

    assert.strictEqual(post.mock.callCount(), 0);
    assert.strictEqual(put.mock.callCount(), 1);
    const payload = put.mock.calls[0].arguments[1] as SonarrSeries;
    assert.strictEqual(payload.addOptions?.monitor, undefined);
  });
});

describe('SonarrAPI removeSeries', () => {
  afterEach(() => mock.restoreAll());

  it('removes the series when it exists in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await sonarr.removeSeries(1234);

    assert.strictEqual(del.mock.callCount(), 1);
    assert.strictEqual(del.mock.calls[0].arguments[0], '/series/9');
  });

  it('does nothing when the series is not in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({
      data: [{ id: 0, title: 'Breaking Bad' }],
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('rejects when the tvdbId is unknown to the lookup', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(() => sonarr.removeSeries(1234), /Series not found/);
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('ignores a 404 when the series was already removed in Sonarr', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 404 } };
    });

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
  });

  it('rethrows errors other than 404', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 500 } };
    });

    await assert.rejects(() => sonarr.removeSeries(1234));
  });

  it('rethrows a 404 from the lookup instead of treating it as removed', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 404 } };
    });
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(
      () => sonarr.removeSeries(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 404
    );
    assert.strictEqual(del.mock.callCount(), 0);
  });
});

describe('SonarrAPI getSeriesByTvdbId', () => {
  afterEach(() => mock.restoreAll());

  it('rethrows a 401 from the lookup with the status intact', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 401 } };
    });

    await assert.rejects(
      () => sonarr.getSeriesByTvdbId(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 401
    );
  });

  it('throws "Series not found" when the lookup returns no results', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));

    await assert.rejects(() => sonarr.getSeriesByTvdbId(1234), {
      message: 'Series not found',
    });
  });
});
