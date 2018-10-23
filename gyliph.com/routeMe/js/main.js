define([
  "dojo/_base/declare",
  "dojo/_base/kernel",
  "dojo/_base/lang",
  "dojo/io-query",
  "esri/config",
  "esri/map",
  "esri/geometry/Point",
  "esri/geometry/Polyline",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/graphic",
  "esri/Color",
  "esri/geometry/webMercatorUtils",
  "esri/request",
  "esri/dijit/PopupTemplate",
  "esri/layers/FeatureLayer",
  "esri/layers/LabelClass",
  "esri/symbols/TextSymbol",
  "esri/symbols/Font",
  "esri/tasks/RouteParameters",
  "esri/tasks/RouteTask",
  "esri/tasks/query",
  "esri/units",
  "esri/tasks/FeatureSet",
  "esri/arcgis/Portal",
  "esri/arcgis/OAuthInfo",
  "esri/IdentityManager",
  "dijit/registry",
  "dojo/query",
  "esri/IdentityManager",
  "application/googlePolyConverter",
  "dojo/on",
  "dojo/dom-class",
  "dojo/Deferred",
  "dojo/domReady!"
], function(
  declare, kernel, lang, ioQuery, esriConfig, Map, Point, Polyline, SimpleMarkerSymbol,
  SimpleLineSymbol, Graphic, Color, webMercatorUtils, esriRequest, PopupTemplate,
  FeatureLayer, LabelClass, TextSymbol, Font, RouteParameters, RouteTask, Query, Units,
  FeatureSet, arcgisPortal, OAuthInfo, esriId, registry, query, esriId,
  googlePolyConverter, on, domClass, Deferred) {
  return declare([], {
    map: null,
    watchId: 0,
    graphic: null,
    routeGraphic: null,
    config: null,
    accessToken: null,
    polyConverter: null,
    popoverTimeout: null,

    loader: null,
    homeButton: null,
    routeButton: null,
    logInButton: null,
    locateButton: null,
    selectButton: null,

    currentLocation: null,

    headerStatus: null,

    graphicsToAdd: [],
    lastVisited_index: 0,

    segmentsLoaded: false,

    routeParams: null,
    routeTask: null,

    selecting: false,

    featureCollection: {
      "layerDefinition": {
        "geometryType": "esriGeometryPolyline",
        "objectIdField": "ObjectID",
        "fields": [{
          "name": "ObjectID",
          "alias": "ObjectID",
          "type": "esriFieldTypeOID"
        }, {
          "name": "name",
          "alias": "name",
          "type": "esriFieldTypeString"
        }, {
          "name": "id",
          "alias": "id",
          "type": "esriFieldTypeInteger"
        }, {
          "name": "distance",
          "alias": "distance",
          "type": "esriFieldTypeDouble"
        }, {
          "name": "elevation_difference",
          "alias": "elevation difference",
          "type": "esriFieldTypeDouble"
        }, {
          "name": "average_grade",
          "alias": "average grade",
          "type": "esriFieldTypeDouble"
        }, {
          "name": "start_lnglat",
          "alias": "start long/lat",
          "type": "esriFieldTypeDouble"
        }, {
          "name": "end_lnglat",
          "alias": "end long/lat",
          "type": "esriFieldTypeDouble"
        }, {
          "name": "visited",
          "alias": "visited",
          "type": "esriFieldTypeInteger"
        }]
      },
      "featureSet": {
        "features": [],
        "geometryType": "esriGeometryPolyline"
      }
    },
    popupTemplate: null,
    featureLayer: null,
    selectedFeatures: [],
    addFeatures: [],
    deleteFeatures: [],

    selectionSymbol: null,
    segmentSymbol: null,

    oAuthInfo: null,
    loggedIn: null,

    startup: function(config) {
      module = this;
      this.config = config;

      esriConfig.defaults.io.corsEnabledServers.push({
        host: this.config.stravaDomain,
        withCredentials: false
      });

      this.polyConverter = new googlePolyConverter(config);

      var uri = window.location.href;
      var query = uri.substring(uri.indexOf("?") + 1, uri.length);
      var queryObject = ioQuery.queryToObject(query);
      if(queryObject.code) {
        oAuthInfo = new OAuthInfo({
          appId: "0FsqwlK8l8eLOwir",
          popup: true
        });
        esriId.registerOAuthInfos([oAuthInfo]);

        var tokenRequest = esriRequest({
          url: "https://" + this.config.stravaDomain + "/oauth/token",
          content: {
            client_id: this.config.stravaClientId,
            client_secret: this.config.stravaClientSecret,
            code: queryObject.code
          },
          handleAs: "json"
        }, {
          usePost: true
        });

        tokenRequest.then(lang.hitch(this, function(response) {
          this.initApp(response.access_token);
        }), function(error) {
          console.log(error);
        });
      }else {
        var authContent =
          "client_id=" + this.config.stravaClientId +
          "&redirect_uri=" + this.config.redirectUri +
          "&response_type=code" +
          "&approval_prompt=auto" +
          "&scope=public";
        window.location = "https://" + this.config.stravaDomain + "/oauth/authorize?" + authContent;
      }
    },

    initApp: function(accessToken) {
      this.accessToken = accessToken;
      if(navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(lang.hitch(this, this.createMap), lang.hitch(this, this.locationError));
        this.watchId = navigator.geolocation.watchPosition(lang.hitch(this, this.updateLocation), lang.hitch(this, this.locationError));
      }else {
        alert("Browser doesn't support Geolocation. Visit http://caniuse.com to see browser support for the Geolocation API.");
      }
    },

    initLayer: function() {
      this.setSymbols();
      this.popupTemplate = new PopupTemplate({
        title: "{"+this.config.labelField+"}",
        fieldInfos: [
          { fieldName: "name", visible: true },
          { fieldName: "id", visible: true },
          { fieldName: "distance", visible: true },
          { fieldName: "elevation_difference", visible: true },
          { fieldName: "average_grade", visible: true },
          { fieldName: "start_lnglat", visible: true },
          { fieldName: "end_lnglat", visible: true },
          { fieldName: "visited", visible: false }
        ]
      });
      this.featureLayer = new FeatureLayer(this.featureCollection, {
        id: "segmentLayer",
        infoTemplate: this.popupTemplate
      });
      this.featureLayer.on("click", lang.hitch(this, function(evt) {
        this.map.infoWindow.setFeatures([evt.graphic]);
        if(this.selecting) {
          this.selectedFeatures.push(evt.graphic)
          evt.graphic.setSymbol(this.selectionSymbol);
        }
      }));

      this.featureLayer.showLabels = true;
      var layerLabel = new TextSymbol().setColor(new Color([0, 0, 0, 1.0]));
      layerLabel.font.setSize("12pt");
      layerLabel.font.setFamily("arial");
      layerLabel.font.setWeight(Font.WEIGHT_BOLD);
      layerLabel.setOffset(0, -5);
      var json = {
        "labelExpressionInfo": {"value": "{"+this.config.labelField+"}"},
        "labelPlacement": "below-along"
      };
      var labelClass = new LabelClass(json);
      labelClass.symbol = layerLabel;
      this.featureLayer.setLabelingInfo([labelClass]);

      this.map.addLayers([this.featureLayer]);
    },

    setSymbols: function() {
      this.segmentSymbol = new SimpleLineSymbol(
        SimpleLineSymbol.STYLE_SOLID,
        new Color([125, 250, 125, 0.75]),
        4
      );
      this.selectionSymbol = new SimpleLineSymbol(
        SimpleLineSymbol.STYLE_SOLID,
        new Color([125, 125, 250, 0.75]),
        6
      );
    },

    locationError: function(error) {
      if( navigator.geolocation ) {
        navigator.geolocation.clearWatch(this.watchId);
      }
      switch (error.code) {
        case error.PERMISSION_DENIED:
          alert("Location not provided");
          break;
        case error.POSITION_UNAVAILABLE:
          alert("Current location not available");
          break;
        case error.TIMEOUT:
          alert("Timeout");
          break;
        default:
          alert("unknown error");
          break;
      }
    },

    initButtons: function() {
      // Route button setup
      domClass.remove(this.routeButton, "hidden");
      on(this.routeButton, "click", lang.hitch(this, function() {
        if(!this.loggedIn) {
          clearTimeout(this.popoverTimeout);
          $('[data-toggle="popover"]').attr('data-content', this.config.logInError)
          $('[data-toggle="popover"]').popover("show");
          domClass.add(this.loader, "hidden");
          this.popoverTimeout = setTimeout(function() {
            $('[data-toggle="popover"]').popover("hide");
          }, 5000);
          return;
        }

        if(this.segmentsLoaded) {
          $('[data-toggle="popover"]').popover("hide");
          this.routeMe();
        }
      }));

      // Login/logout button setup
      esriId.checkSignInStatus(oAuthInfo.portalUrl).then(lang.hitch(this, function(credential) {
        this.logIn(credential);
        domClass.remove(this.headerStatus, "hidden");
      }), lang.hitch(this, function(error) {
        this.logOut();
        domClass.remove(this.headerStatus, "hidden");
      }));
      on(this.logInButton, "click", lang.hitch(this, function() {
        esriId.getCredential(oAuthInfo.portalUrl + "/sharing", {
          oAuthPopupConfirmation: false
        }).then(lang.hitch(this, function(credential) {
          if(!this.loggedIn) {
            this.logIn(credential);
          }else if(this.loggedIn) {
            this.logOut(credential);
          }
        }));
      }));

      // Locate button setup
      domClass.remove(this.locateButton, "hidden");
      on(this.locateButton, "click", lang.hitch(this, this.showLocation));

      // Select button setup
      domClass.remove(this.selectButton, "hidden");
      on(this.selectButton, "click", lang.hitch(this, this.toggleSelection));

      // Home button setup
      domClass.remove(this.homeButton, "hidden");
      on(this.homeButton, "click", function() { window.location.href=".." });
    },

    logIn(credential) {
      var loText = "log out"
      this.loggedIn = true;
      this.logInButton.innerHTML = loText;
      this.userText.innerHTML = credential.userId;
    },
    logOut(credential) {
      var liText = "log in"
      this.loggedIn = false;
      this.logInButton.innerHTML = liText;
      this.userText.innerHTML = "";
      if(credential) {
        credential.destroy();
      }
    },

    refreshSegments: function() {
      this.segmentsLoaded = false;

      var normalizedMin = webMercatorUtils.xyToLngLat(this.map.extent.xmin, this.map.extent.ymin);
      var normalizedMax = webMercatorUtils.xyToLngLat(this.map.extent.xmax, this.map.extent.ymax);
      var segmentRequest = esriRequest({
        url: "https://" + this.config.stravaDomain + "/api/v3/segments/explore",
        content: {
          bounds:
            normalizedMin[1] + "," + normalizedMin[0] + "," +
            normalizedMax[1] + "," + normalizedMax[0],
          activity_type: "riding",
          min_cat: 0,
          max_cat: 5,
          access_token: this.accessToken
        },
        handleAs: "json"
      });

      segmentRequest.then(lang.hitch(this, function(response) {
        if(response.segments.length > 0) {
          this.featureLayer.clear();
          this.addFeatures = [];
          this.addFeatures = this.addFeatures.concat(this.selectedFeatures);
          response.segments.forEach(lang.hitch(this, function(segment) {
            var attr = {};
            attr["name"] = segment.name;
            attr["id"] = segment.id;
            attr["average_grade"] = segment.avg_grade;
            attr["elevation_difference"] = segment.elev_difference;
            attr["distance"] = segment.distance;
            attr["start_lnglat"] = segment.start_latlng.reverse();
            attr["end_lnglat"] = segment.end_latlng.reverse();
            attr["visited"] = 0;
            var lineGraphic = this.polyConverter.decodePoly_toGraphic(segment.points, this.segmentSymbol);
            lineGraphic.setAttributes(attr);
            var found = this.addFeatures.find(lang.hitch(this, function (graphic) {
              return graphic.attributes.id === lineGraphic.attributes.id;
            }));
            if(!found) {
              this.addFeatures.push(lineGraphic);
            }
          }));
          this.featureLayer.applyEdits(this.addFeatures, null, null).then(lang.hitch(this, function(edits) {
            this.segmentsLoaded = true;
          }));
        }
      }), function(error) {
        console.log(error);
      });
    },

    createMap: function(location) {
      this.currentLocation = location;
      var pt = new Point(location.coords.longitude, location.coords.latitude);
      this.map = new Map("map", {
        basemap: "topo",
        center: pt,
        zoom: 15,
        showLabels: true
      });
      this.map.on("load", lang.hitch(this, function() {
        this.loader = query(".loader")[0];
        this.homeButton = query(".homeButton")[0];
        this.routeButton = query(".routeButton")[0];
        this.logInButton = query(".logInButton")[0];
        this.headerStatus = query(".header .status")[0];
        this.userText = query(".status .userText")[0];
        this.locateButton = query("#map .locate")[0];
        this.selectButton = query(".selectButton")[0];
        this.initButtons();
        this.initLayer();
        this.addGraphic(pt);
        domClass.add(this.loader, "hidden");
      }));
      this.map.on("extent-change", lang.hitch(this, this.refreshSegments));
    },

    routeMe_OG: function() {
      domClass.remove(this.loader, "hidden");

      //Do stuff

      domClass.add(this.loader, "hidden");
    },

    routeMe: function() {
      domClass.remove(this.loader, "hidden");
      this.routeParams = new RouteParameters();
      this.routeParams.stops = new FeatureSet();

      var graphicsToRoute = this.featureLayer.graphics;
      if(this.selecting) {
        graphicsToRoute = this.selectedFeatures;
      }

      var featureCount = graphicsToRoute.length;
      var counter = 0;
      var startAndEnd = new Point(this.currentLocation.coords.longitude,
        this.currentLocation.coords.latitude);
      graphicsToRoute.forEach(lang.hitch(this, function(lineGraphic) {
        if(counter === 0) {
          this.routeParams.stops.features.push(new Graphic(startAndEnd));
        }

        var i;
        for(i=0; i<lineGraphic.geometry.paths.length; i++) {
          var path = lineGraphic.geometry.paths[i];
          var j;
          for(j=0; j<path.length; j++) {
            this.routeParams.stops.features.push(new Graphic(
              lineGraphic.geometry.getPoint(i, j)
            ));
          }
        }

        if(++counter === featureCount) {
          this.routeParams.stops.features.push(new Graphic(startAndEnd));
        }
      }));
      this.routeParams.returnRoutes = true;
      this.routeParams.returnDirections = false;
      this.routeParams.directionsLengthUnits = Units.MILES;
      this.routeParams.outSpatialReference = this.map.spatialReference;
      this.routeParams.ignoreInvalidLocations = true;
      this.routeParams.restrictUTurns = "NO_BACKTRACK";
      this.routeParams.findBestSequence = false;
      this.routeParams.preserveFirstStop = true;
      this.routeParams.preserveLastStop = true;
      this.routeParams.returnStops = true;

      this.routeTask = new RouteTask(this.config.routeService);
      this.routeTask.solve(this.routeParams, lang.hitch(this, function(success) {
        if(this.routeGraphic) { this.map.graphics.remove(this.routeGraphic); }
        success.routeResults[0].route.symbol = new SimpleLineSymbol(
          SimpleLineSymbol.STYLE_SOLID,
          new Color([200, 50, 50, 0.5]),
          4
        )
        this.routeGraphic = success.routeResults[0].route
        this.map.graphics.add(this.routeGraphic);
        domClass.add(this.loader, "hidden");
      }), lang.hitch(this, function(error) {
        clearTimeout(this.popoverTimeout);
        $('[data-toggle="popover"]').attr('data-content',
        this.selecting ? this.config.routeErrorSelect : this.config.routeError)
        $('[data-toggle="popover"]').popover("show");
        domClass.add(this.loader, "hidden");
        this.popoverTimeout = setTimeout(function() {
          $('[data-toggle="popover"]').popover("hide");
        }, 5000);
      }));
    },

    updateLocation: function(location) {
      this.currentLocation = location;
    },

    showLocation: function() {
      var pt = new Point(this.currentLocation.coords.longitude,
        this.currentLocation.coords.latitude);
      if(!this.graphic) {
        lang.hitch(this, this.addGraphic(pt));
      }else { // move the graphic if it already exists
        this.graphic.setGeometry(pt);
      }
      this.map.centerAt(pt);
    },

    toggleSelection: function() {
      this.selecting = !this.selecting;
      if(this.selecting) {
        domClass.add(this.selectButton, "selecting");
        this.selectButton.style.background = "#AA0000";
        this.selectButton.style["border-color"] = "#550000";
        this.routeButton.innerHTML = this.config.routeSelect;
      }else {
        domClass.remove(this.selectButton, "selecting");
        this.selectButton.style.background = "#00AA00";
        this.selectButton.style["border-color"] = "#005500";
        this.routeButton.innerHTML = this.config.routeNoSelect;
        this.selectedFeatures = [];
        this.refreshSegments();
      }
    },

    addGraphic: function(pt) {
      var symbol = new SimpleMarkerSymbol(
        SimpleMarkerSymbol.STYLE_CIRCLE,
        12,
        new SimpleLineSymbol(
          SimpleLineSymbol.STYLE_SOLID,
          new Color([210, 105, 30, 0.5]),
          8
        ),
        new Color([210, 105, 30, 0.9])
      );
      this.graphic = new Graphic(pt, symbol);
      if(this.map !== null && this.map.loaded) {
        this.map.graphics.add(this.graphic);
      }
    }
  });
});
