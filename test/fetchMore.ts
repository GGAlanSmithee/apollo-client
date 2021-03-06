import * as chai from 'chai';
const { assert } = chai;

import mockNetworkInterface from './mocks/mockNetworkInterface';
import ApolloClient from '../src';
import { ObservableQuery } from '../src/core/ObservableQuery';

import { assign, cloneDeep } from 'lodash';

import gql from 'graphql-tag';

describe('updateQuery on a simple query', () => {
  const query = gql`
    query thing {
      entry {
        value
        __typename
      }
      __typename
    }
  `;
  const result = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        value: 1,
      },
    },
  };

  it('triggers new result from updateQuery', () => {
    let latestResult: any = null;
    const networkInterface = mockNetworkInterface({
      request: { query },
      result,
    });

    const client = new ApolloClient({
      networkInterface,
      addTypename: true,
    });

    const obsHandle = client.watchQuery({
      query,
    });
    const sub = obsHandle.subscribe({
      next(queryResult) {
        // do nothing
        latestResult = queryResult;
      },
    });

    return new Promise((resolve) => setTimeout(resolve))
      .then(() => obsHandle)
      .then((watchedQuery: ObservableQuery<any>) => {
        assert.equal(latestResult.data.entry.value, 1);
        watchedQuery.updateQuery((prevResult: any) => {
          const res = cloneDeep(prevResult);
          res.entry.value = 2;
          return res;
        });

        assert.equal(latestResult.data.entry.value, 2);
      })
      .then(() => sub.unsubscribe());
  });
});

describe('fetchMore on an observable query', () => {
  const query = gql`
    query Comment($repoName: String!, $start: Int!, $limit: Int!) {
      entry(repoFullName: $repoName) {
        comments(start: $start, limit: $limit) {
          text
          __typename
        }
        __typename
      }
    }
  `;
  const query2 = gql`
    query NewComments($start: Int!, $limit: Int!) {
      comments(start: $start, limit: $limit) {
        text
        __typename
      }
      __typename
    }
  `;
  const variables = {
    repoName: 'org/repo',
    start: 0,
    limit: 10,
  };
  const variablesMore = assign({}, variables, { start: 10, limit: 10 });
  const variables2 = {
    start: 10,
    limit: 20,
  };

  const result: any = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        comments: [],
      },
    },
  };
  const resultMore = cloneDeep(result);
  const result2: any = {
    data: {
      __typename: 'Query',
      comments: [],
    },
  };
  for (let i = 1; i <= 10; i++) {
    result.data.entry.comments.push({ text: `comment ${i}`, __typename: 'Comment' });
  }
  for (let i = 11; i <= 20; i++) {
    resultMore.data.entry.comments.push({ text: `comment ${i}`, __typename: 'Comment' });
    result2.data.comments.push({ text: `new comment ${i}`, __typename: 'Comment' });
  }

  let latestResult: any = null;

  let client: ApolloClient;
  let networkInterface: any;
  let sub: any;

  function setup(...mockedResponses: any[]) {
    networkInterface = mockNetworkInterface({
      request: {
        query,
        variables,
      },
      result,
    }, ...mockedResponses);

    client = new ApolloClient({
      networkInterface,
      addTypename: true,
    });

    const obsHandle = client.watchQuery<any>({
      query,
      variables,
    });
    sub = obsHandle.subscribe({
      next(queryResult) {
        // do nothing
        latestResult = queryResult;
      },
    });

    return Promise.resolve(obsHandle);
  };

  function unsetup() {
    sub.unsubscribe();
    sub = null;
  }

  it('basic fetchMore results merging', () => {
    latestResult = null;
    return setup({
      request: {
        query,
        variables: variablesMore,
      },
      result: resultMore,
    }).then((watchedQuery) => {
      return watchedQuery.fetchMore({
        variables: { start: 10 }, // rely on the fact that the original variables had limit: 10
        updateQuery: (prev, options) => {
          const state = cloneDeep(prev) as any;
          state.entry.comments = [...state.entry.comments, ...(options.fetchMoreResult as any).data.entry.comments];
          return state;
        },
      });
    }).then(data => {
      assert.lengthOf(data.data.entry.comments, 10); // this is the server result
      assert.isFalse(data.loading);
      const comments = latestResult.data.entry.comments;
      assert.lengthOf(comments, 20);
      for (let i = 1; i <= 20; i++) {
        assert.equal(comments[i - 1].text, `comment ${i}`);
      }
      unsetup();
    });
  });

  it('fetching more with a different query', () => {
    latestResult = null;
    return setup({
      request: {
        query: query2,
        variables: variables2,
      },
      result: result2,
    }).then((watchedQuery) => {
      return watchedQuery.fetchMore({
        query: query2,
        variables: variables2,
        updateQuery: (prev, options) => {
          const state = cloneDeep(prev) as any;
          state.entry.comments = [...state.entry.comments, ...(options.fetchMoreResult as any).data.comments];
          return state;
        },
      });
    }).then(() => {
      const comments = latestResult.data.entry.comments;
      assert.lengthOf(comments, 20);
      for (let i = 1; i <= 10; i++) {
        assert.equal(comments[i - 1].text, `comment ${i}`);
      }
      for (let i = 11; i <= 20; i++) {
        assert.equal(comments[i - 1].text, `new comment ${i}`);
      }
      unsetup();
    });
  });
});
