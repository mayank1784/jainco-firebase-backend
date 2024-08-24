import { algoliasearch } from "algoliasearch";
import * as functions from "firebase-functions";

export const client = algoliasearch(
  functions.config().algolia.appid,
  functions.config().algolia.apikey
);
