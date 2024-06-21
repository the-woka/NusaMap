"use strict";

const Hapi = require("@hapi/hapi");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const decodePolyline = (polyline) => {
  let currentPosition = 0;
  const points = [];
  const len = polyline.length;
  let lat = 0;
  let lng = 0;

  while (currentPosition < len) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = polyline.charCodeAt(currentPosition++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = polyline.charCodeAt(currentPosition++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
};

const getPlacesAlongRoute = async (route, apiKey) => {
  try {
    const placeTypes = ["gas_station", "rest_stop", "lodging"];
    const places = {};
    for (const type of placeTypes) {
      places[type] = [];
    }

    const polyline = route.overview_polyline.points;
    const polylinePoints = decodePolyline(polyline);

    const requests = [];
    for (const point of polylinePoints) {
      placeTypes.forEach((type) => {
        requests.push(
          axios
            .get(
              "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
              {
                params: {
                  location: `${point.lat},${point.lng}`,
                  radius: "1000", // 1km radius bisa di perkecil/diperbesar
                  type: type,
                  key: apiKey,
                },
              }
            )
            .catch((error) => {
              console.error(
                "Error fetching places:",
                error.response?.data || error.message
              );
              return null;
            })
        );
      });
    }

    const responses = await Promise.all(requests);
    responses.forEach((response) => {
      if (response && response.data && response.data.results) {
        response.data.results.forEach((place) => {
          const type = place.types.find((t) => placeTypes.includes(t));
          if (type) {
            places[type].push(place);
          }
        });
      }
    });

    return places;
  } catch (error) {
    console.error(
      "Failed to fetch places from Google Places API:",
      error.response?.data || error.message
    );
    throw error;
  }
};

const init = async () => {
  const server = Hapi.server({
    port: process.env.PORT || 3000,
    host: "0.0.0.0", // Ubah ke '0.0.0.0' untuk deploy di Vercel
  });

  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_MAPS_API_KEY) {
    console.error(
      "Google Maps API key is not set. Please set the GOOGLE_MAPS_API_KEY in your .env file."
    );
    process.exit(1);
  }

  server.route({
    method: "GET",
    path: "/",
    handler: (request, h) => {
      return "Server is running!";
    },
  });

  server.route({
    method: "POST",
    path: "/api/get-route",
    handler: async (request, h) => {
      const { start, destination, vehicleType } = request.payload;

      try {
        console.log("Received /api/get-route request");
        console.log("Payload:", request.payload);

        const directionsResponse = await axios.get(
          "https://maps.googleapis.com/maps/api/directions/json",
          {
            params: {
              origin: `${start.lat},${start.lng}`,
              destination: destination,
              travelMode: "DRIVING",
              vehicleType: vehicleType,
              key: GOOGLE_MAPS_API_KEY,
            },
          }
        );

        const route = directionsResponse.data.routes[0];

        // Fetch places along the route
        const places = await getPlacesAlongRoute(route, GOOGLE_MAPS_API_KEY);

        return { route, places };
      } catch (error) {
        console.error(
          "Failed to fetch route from Google Maps API:",
          error.response?.data || error.message
        );
        return h
          .response({ error: "Failed to fetch route from Google Maps API" })
          .code(500);
      }
    },
  });

  server.route({
    method: "POST",
    path: "/api/find-nearest",
    handler: async (request, h) => {
      const { pos, type } = request.payload;

      try {
        console.log("Received /api/find-nearest request");
        console.log("Payload:", request.payload);

        const placesResponse = await axios.get(
          "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
          {
            params: {
              location: `${pos.lat},${pos.lng}`,
              radius: "5000", // 5km radius bisa di perkecil/diperbesar
              type: type,
              key: GOOGLE_MAPS_API_KEY,
            },
          }
        );

        const nearest = placesResponse.data.results[0];
        console.log("API nearest:", nearest);
        return { nearest };
      } catch (error) {
        console.error(
          "Failed to fetch nearby places from Google Places API:",
          error.response?.data || error.message
        );
        return h
          .response({
            error: "Failed to fetch nearby places from Google Places API",
          })
          .code(500);
      }
    },
  });

  await server.start();
  console.log("Server running on %s", server.info.uri);
};

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

// Jalankan fungsi async init
init();
