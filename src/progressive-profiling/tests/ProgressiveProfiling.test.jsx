import React from 'react';
import { Provider } from 'react-redux';

import { getConfig, mergeConfig } from '@edx/frontend-platform';
import { identifyAuthenticatedUser, sendTrackEvent } from '@edx/frontend-platform/analytics';
import { getAuthenticatedUser } from '@edx/frontend-platform/auth';
import { configure, injectIntl, IntlProvider } from '@edx/frontend-platform/i18n';
import { mount } from 'enzyme';
import { createMemoryHistory } from 'history';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Router } from 'react-router-dom';
import configureStore from 'redux-mock-store';

import {
  AUTHN_PROGRESSIVE_PROFILING,
  COMPLETE_STATE, DEFAULT_REDIRECT_URL,
  EMBEDDED,
  FAILURE_STATE,
  RECOMMENDATIONS,
} from '../../data/constants';
import { saveUserProfile } from '../data/actions';
import ProgressiveProfiling from '../ProgressiveProfiling';

const IntlProgressiveProfilingPage = injectIntl(ProgressiveProfiling);
const mockStore = configureStore();

jest.mock('@edx/frontend-platform/analytics', () => ({
  sendPageEvent: jest.fn(),
  sendTrackEvent: jest.fn(),
  identifyAuthenticatedUser: jest.fn(),
}));
jest.mock('@edx/frontend-platform/auth', () => ({
  configure: jest.fn(),
  ensureAuthenticatedUser: jest.fn().mockImplementation(() => Promise.resolve(true)),
  hydrateAuthenticatedUser: jest.fn().mockImplementation(() => Promise.resolve(true)),
  getAuthenticatedUser: jest.fn(),
}));
jest.mock('@edx/frontend-platform/logging', () => ({
  getLoggingService: jest.fn(),
}));
jest.mock('../../recommendations/optimizelyExperiment.js', () => ({
  activateRecommendationsExperiment: jest.fn().mockImplementation(() => 'welcome_page_recommendations_enabled'),
  trackRecommendationViewedOptimizely: jest.fn(),
  RECOMMENDATIONS_EXP_VARIATION: 'welcome_page_recommendations_enabled',
}));

const history = createMemoryHistory();

describe('ProgressiveProfilingTests', () => {
  mergeConfig({
    AUTHN_PROGRESSIVE_PROFILING_SUPPORT_LINK: 'http://localhost:1999/welcome',
  });
  const registrationResult = { redirectUrl: getConfig().LMS_BASE_URL + DEFAULT_REDIRECT_URL, success: true };
  const fields = {
    company: { name: 'company', type: 'text', label: 'Company' },
    gender: {
      name: 'gender',
      type: 'select',
      label: 'Gender',
      options: [['m', 'Male'], ['f', 'Female'], ['o', 'Other/Prefer Not to Say']],
    },
  };
  const extendedProfile = ['company'];
  const optionalFields = { fields, extended_profile: extendedProfile };
  let props = {};
  let store = {};
  const DASHBOARD_URL = getConfig().LMS_BASE_URL.concat(DEFAULT_REDIRECT_URL);
  const initialState = {
    welcomePage: {},
    commonComponents: {
      thirdPartyAuthApiStatus: null,
      optionalFields: {},
    },
  };

  const reduxWrapper = children => (
    <IntlProvider locale="en">
      <MemoryRouter>
        <Provider store={store}>{children}</Provider>
      </MemoryRouter>
    </IntlProvider>
  );

  const getProgressiveProfilingPage = async () => {
    const progressiveProfilingPage = mount(reduxWrapper(
      <Router history={history}>
        <IntlProgressiveProfilingPage {...props} />
      </Router>,
    ));
    await act(async () => {
      await Promise.resolve(progressiveProfilingPage);
      await new Promise(resolve => { setImmediate(resolve); });
      progressiveProfilingPage.update();
    });

    return progressiveProfilingPage;
  };

  beforeEach(() => {
    store = mockStore(initialState);
    configure({
      loggingService: { logError: jest.fn() },
      config: {
        ENVIRONMENT: 'production',
        LANGUAGE_PREFERENCE_COOKIE_NAME: 'yum',
      },
      messages: { 'es-419': {}, de: {}, 'en-us': {} },
    });
    props = {
      location: {
        state: {
          registrationResult,
          optionalFields,
        },
      },
    };
  });

  it('should not display button "Learn more about how we use this information."', async () => {
    mergeConfig({
      AUTHN_PROGRESSIVE_PROFILING_SUPPORT_LINK: '',
    });
    const progressiveProfilingPage = await getProgressiveProfilingPage();

    expect(progressiveProfilingPage.find('a.pgn__hyperlink').exists()).toBeFalsy();
  });

  it('should display button "Learn more about how we use this information."', async () => {
    mergeConfig({
      AUTHN_PROGRESSIVE_PROFILING_SUPPORT_LINK: 'http://localhost:1999/support',
    });
    const progressiveProfilingPage = await getProgressiveProfilingPage();

    expect(progressiveProfilingPage.find('a.pgn__hyperlink').text()).toEqual('Learn more about how we use this information.');
  });

  it('should make identify call to segment on progressive profiling page', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    await getProgressiveProfilingPage();
    expect(identifyAuthenticatedUser).toHaveBeenCalledWith(3);
    expect(identifyAuthenticatedUser).toHaveBeenCalled();
  });

  it('should submit user profile details on form submission', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    const formPayload = {
      gender: 'm',
      extended_profile: [{ field_name: 'company', field_value: 'test company' }],
    };
    store.dispatch = jest.fn(store.dispatch);
    const progressiveProfilingPage = await getProgressiveProfilingPage();
    progressiveProfilingPage.find('select#gender').simulate('change', { target: { value: 'm', name: 'gender' } });
    progressiveProfilingPage.find('input#company').simulate('change', { target: { value: 'test company', name: 'company' } });

    progressiveProfilingPage.find('button.btn-brand').simulate('click');
    expect(store.dispatch).toHaveBeenCalledWith(saveUserProfile('abc123', formPayload));
  });

  it('should set host property value to host where iframe is embedded for on ramp experience', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    const expectedEventProperties = {
      isGenderSelected: false,
      isYearOfBirthSelected: false,
      isLevelOfEducationSelected: false,
      host: 'http://example.com',
    };
    delete window.location;
    window.location = { href: getConfig().BASE_URL.concat(AUTHN_PROGRESSIVE_PROFILING), search: '?host=http://example.com' };
    const progressiveProfilingPage = await getProgressiveProfilingPage();
    progressiveProfilingPage.find('button.btn-brand').simulate('click');
    expect(sendTrackEvent).toHaveBeenCalledWith('edx.bi.welcome.page.submit.clicked', expectedEventProperties);
  });

  it('should set host property value empty for non-embedded experience', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    const expectedEventProperties = {
      isGenderSelected: false,
      isYearOfBirthSelected: false,
      isLevelOfEducationSelected: false,
      host: '',
    };
    delete window.location;
    window.location = { href: getConfig().BASE_URL.concat(AUTHN_PROGRESSIVE_PROFILING) };
    const progressiveProfilingPage = await getProgressiveProfilingPage();
    progressiveProfilingPage.find('button.btn-brand').simulate('click');
    expect(sendTrackEvent).toHaveBeenCalledWith('edx.bi.welcome.page.submit.clicked', expectedEventProperties);
  });

  it('should set host property value embedded host for on ramp experience for skip link event', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    const host = 'http://example.com';
    delete window.location;
    window.location = { href: getConfig().BASE_URL.concat(AUTHN_PROGRESSIVE_PROFILING), search: `?host=${host}` };
    const progressiveProfilingPage = await getProgressiveProfilingPage();

    progressiveProfilingPage.find('button.btn-link').simulate('click');
    expect(sendTrackEvent).toHaveBeenCalledWith('edx.bi.welcome.page.skip.link.clicked', { host });
  });

  it('should open modal on pressing skip for now button', async () => {
    getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
    delete window.location;
    window.location = { href: getConfig().BASE_URL.concat(AUTHN_PROGRESSIVE_PROFILING) };
    const progressiveProfilingPage = await getProgressiveProfilingPage();

    progressiveProfilingPage.find('button.btn-link').simulate('click');
    expect(progressiveProfilingPage.find('.pgn__modal-content-container').exists()).toBeTruthy();
    expect(sendTrackEvent).toHaveBeenCalledWith('edx.bi.welcome.page.skip.link.clicked', { host: '' });
  });

  it('should send analytic event for support link click', async () => {
    const progressiveProfilingPage = await getProgressiveProfilingPage();

    progressiveProfilingPage.find('.pp-page__support-link a[target="_blank"]').simulate('click');
    expect(sendTrackEvent).toHaveBeenCalledWith('edx.bi.welcome.page.support.link.clicked');
  });

  it('should show error message when patch request fails', async () => {
    store = mockStore({
      ...initialState,
      welcomePage: {
        ...initialState.welcomePage,
        showError: true,
      },
    });

    const progressiveProfilingPage = await getProgressiveProfilingPage();
    expect(progressiveProfilingPage.find('#pp-page-errors').exists()).toBeTruthy();
  });

  describe('Recommendations test', () => {
    mergeConfig({
      ENABLE_PERSONALIZED_RECOMMENDATIONS: true,
    });

    it('should redirect to recommendations page if recommendations are enabled', async () => {
      store = mockStore({
        ...initialState,
        welcomePage: {
          ...initialState.welcomePage,
          success: true,
        },
      });

      getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
      const progressiveProfilingPage = await getProgressiveProfilingPage();

      expect(progressiveProfilingPage.find('button.btn-brand').text()).toEqual('Next');
      expect(history.location.pathname).toEqual(RECOMMENDATIONS);
    });

    it('should not redirect to recommendations page if user is on its way to enroll in a course', async () => {
      const redirectUrl = `${getConfig().LMS_BASE_URL}${DEFAULT_REDIRECT_URL}?enrollment_action=1`;
      props = {
        location: {
          state: {
            registrationResult: {
              redirectUrl,
              success: true,
            },
            optionalFields,
          },
        },
      };

      store = mockStore({
        ...initialState,
        welcomePage: {
          ...initialState.welcomePage,
          success: true,
        },
      });

      getAuthenticatedUser.mockReturnValue({ userId: 3, username: 'abc123' });
      const progressiveProfilingPage = await getProgressiveProfilingPage();

      expect(progressiveProfilingPage.find('button.btn-brand').text()).toEqual('Submit');
      expect(window.location.href).toEqual(redirectUrl);
    });
  });

  describe('Embedded Form Workflow Test', () => {
    mergeConfig({
      SEARCH_CATALOG_URL: 'http://localhost/search',
    });

    delete window.location;
    window.location = {
      assign: jest.fn().mockImplementation((value) => { window.location.href = value; }),
      href: getConfig().BASE_URL,
      search: `?variant=${EMBEDDED}`,
    };

    it('should render fields returned by backend API', async () => {
      delete window.location;
      window.location = {
        assign: jest.fn().mockImplementation((value) => { window.location.href = value; }),
        href: getConfig().BASE_URL,
        search: `?variant=${EMBEDDED}&host=http://localhost/host-website`,
      };
      props = {};
      store = mockStore({
        ...initialState,
        commonComponents: {
          ...initialState.commonComponents,
          thirdPartyAuthApiStatus: COMPLETE_STATE,
          optionalFields,
        },
      });

      const progressiveProfilingPage = await getProgressiveProfilingPage();
      expect(progressiveProfilingPage.find('#gender').exists()).toBeTruthy();
    });

    it('should redirect to dashboard if API call to get form field fails', async () => {
      delete window.location;
      window.location = {
        assign: jest.fn().mockImplementation((value) => { window.location.href = value; }),
        href: getConfig().BASE_URL,
        search: `?variant=${EMBEDDED}`,
      };
      props = {};
      store = mockStore({
        ...initialState,
        commonComponents: {
          ...initialState.commonComponents,
          thirdPartyAuthApiStatus: FAILURE_STATE,
        },
      });

      await getProgressiveProfilingPage();
      expect(window.location.href).toBe(DASHBOARD_URL);
    });
  });
});
