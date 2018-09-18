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
  "esri/units",
  "esri/tasks/FeatureSet",
  "esri/arcgis/Portal",
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
  FeatureLayer, LabelClass, TextSymbol, Font, RouteParameters, RouteTask, Units,
  FeatureSet, arcgisPortal, registry, query, esriId, googlePolyConverter, on, domClass,
  Deferred) {
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
    routeButton: null,

    graphicsToAdd: [],
    lastVisited_index: 0,

    segmentsLoaded: false,

    routeParams: null,
    routeTask: null,

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
    addFeatures: [],
    deleteFeatures: [],

    startup: function(config) {
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
        watchId = navigator.geolocation.watchPosition(lang.hitch(this, this.showLocation), lang.hitch(this, this.locationError));
      }else {
        alert("Browser doesn't support Geolocation. Visit http://caniuse.com to see browser support for the Geolocation API.");
      }
    },

    initLayer: function() {
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
      this.featureLayer.on("click", function(evt) {
        this.map.infoWindow.setFeatures([evt.graphic]);
      });

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

    locationError: function(error) {
      if( navigator.geolocation ) {
        navigator.geolocation.clearWatch(watchId);
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

    initButton: function() {
      domClass.remove(this.routeButton, "hidden");
      on(this.routeButton, "click", lang.hitch(this, function() {
        if(this.segmentsLoaded) {
          $('[data-toggle="popover"]').popover("hide");
          this.routeMe();
        }
      }));
    },

    createMap: function(location) {
      var pt = new Point(location.coords.longitude, location.coords.latitude);
      this.map = new Map("map", {
        basemap: "topo",
        center: pt,
        zoom: 15,
        showLabels: true
      });
      this.map.on("load", lang.hitch(this, function() {
        this.loader = query(".loader")[0];
        this.routeButton = query(".routeButton")[0];
        this.initButton();
        this.initLayer();
        this.addGraphic(pt);
        domClass.add(this.loader, "hidden");
      }));
      this.map.on("extent-change", lang.hitch(this, function() {
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
            this.deleteFeatures = this.addFeatures;
            this.addFeatures = [];
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
              var lineSymbol = new SimpleLineSymbol(
                SimpleLineSymbol.STYLE_SOLID,
                new Color([125, 250, 125, 0.75]),
                4
              );
              var lineGraphic = this.polyConverter.decodePoly_toGraphic(segment.points, lineSymbol);
              lineGraphic.setAttributes(attr);
              this.addFeatures.push(lineGraphic);
            }));
            this.featureLayer.applyEdits(this.addFeatures, null, this.deleteFeatures).then(lang.hitch(this, function(edits) {
              this.segmentsLoaded = true;
            }));
          }
        }), function(error) {
          console.log(error);
        });
      }));
    },

    /*throughStartEnd(index, startGraphic, start_end, dist, nextGraphic, lineGraphic_index, callback) {
      if(index < 2) {
        var se = start_end[index];
        this.routeParams.stops.features = [];
        this.routeParams.stops.features.push(startGraphic);
        this.routeParams.stops.features.push(se);
        this.routeTask.solve(this.routeParams, lang.hitch(this, function(success) {
          var rtg = success.routeResults[0].route;
          if((rtg.attributes.Total_Miles < dist) || (dist === -1)) {
            if(dist !== -1) {
              this.graphicsToAdd.pop();
              this.featureLayer.graphics[this.lastVisited_index].attr("visited", 0);
            }
            dist = rtg.attributes.Total_Miles;
            nextGraphic = start_end[2 % (index+1)];
            rtg.symbol = new SimpleLineSymbol(
              SimpleLineSymbol.STYLE_SOLID,
              new Color([200, 50, 50, 0.5]),
              6
            );
            this.graphicsToAdd.push(rtg);
            this.featureLayer.graphics[lineGraphic_index].attr("visited", 1);
            this.lastVisited_index = lineGraphic_index;
          }
          this.throughStartEnd(index+1, startGraphic, start_end, dist, nextGraphic, lineGraphic_index, callback);
        }), lang.hitch(this, function(error) {
          callback(null)
        }));
      }else {
        callback([dist, nextGraphic]);
      }
    },

    throughLayers(index, dist, nextGraphic, startGraphic) {
      lineGraphic = this.featureLayer.graphics[index];
      if(startGraphic === null && nextGraphic === null) {
        startGraphic = new Graphic(new Point(
          lineGraphic.attributes.end_lnglat[0],
          lineGraphic.attributes.end_lnglat[1]
        ));
        this.featureLayer.graphics[index].attr("visited", 1);
        this.throughLayers(index+1, dist, nextGraphic, startGraphic);
      }else if(index < this.featureLayer.graphics.length) {
        if(lineGraphic.attributes["visited"] === 0) {
          var start_end = [];
          start_end.push(new Graphic(new Point(
            lineGraphic.attributes.start_lnglat[0],
            lineGraphic.attributes.start_lnglat[1]
          )));
          start_end.push(new Graphic(new Point(
            lineGraphic.attributes.end_lnglat[0],
            lineGraphic.attributes.end_lnglat[1]
          )));

          this.throughStartEnd(0, startGraphic, start_end, dist, nextGraphic, index,
            lang.hitch(this, function(tseReturn) {
              if(tseReturn) {
                dist = tseReturn[0]; nextGraphic = tseReturn[1];
                this.throughLayers(index+1, dist, nextGraphic, startGraphic);
              }
          }));
        }else { console.log("VISITED!"); this.throughLayers(index+1, dist, nextGraphic, startGraphic); }
      }else {
        startGraphic = nextGraphic;
        this.throughLayers(0, -1, nextGraphic, startGraphic);
      }

    },

    routeMe2: function() {
      this.routeParams = new RouteParameters();
      this.routeParams.stops = new FeatureSet();
      this.routeParams.returnRoutes = true;
      this.routeParams.returnDirections = false;
      this.routeParams.directionsLengthUnits = Units.MILES;
      this.routeParams.outSpatialReference = this.map.spatialReference;
      this.routeTask = new RouteTask(this.config.routeService);
      this.map.graphics.clear();
      this.graphicsToAdd = [];
      this.lastVisited_index = 0;
      if(this.throughLayers(0, -1, null, null)) {
        console.log("route success!!!");
        console.log(this.graphicsToAdd);
      }else {
        console.log("route error!!!");
      }
    },*/

    routeMe_OG: function() {
      domClass.remove(this.loader, "hidden");

      //Do stuff

      domClass.add(this.loader, "hidden");
    },

    routeMe: function() {
      domClass.remove(this.loader, "hidden");
      this.routeParams = new RouteParameters();
      this.routeParams.stops = new FeatureSet();
      this.featureLayer.graphics.forEach(lang.hitch(this, function(lineGraphic) {
        var i;
        for(i=0; i<lineGraphic.geometry.paths.length; i++) {
          var path = lineGraphic.geometry.paths[i];
          var j;
          for(j=0; j<path.length; j++) {
            this.routeParams.stops.features.push(new Graphic(
              lineGraphic.geometry.getPoint(i, j)),
            );
          }
        }
      }));
      this.routeParams.returnRoutes = true;
      this.routeParams.returnDirections = false;
      this.routeParams.directionsLengthUnits = Units.MILES;
      this.routeParams.outSpatialReference = this.map.spatialReference;
      this.routeParams.ignoreInvalidLocations = true;
      this.routeParams.restrictUTurns = "NO_BACKTRACK";
      this.routeParams.findBestSequence = true;
      this.routeParams.preserveFirstStop = false;
      this.routeParams.preserveLastStop = false;
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
        $('[data-toggle="popover"]').popover("show");
        domClass.add(this.loader, "hidden");
        this.popoverTimeout = setTimeout(function() {
          $('[data-toggle="popover"]').popover("hide");
        }, 5000);
      }));
    },

    showLocation: function(location) {
      var pt = new Point(location.coords.longitude, location.coords.latitude);
      if(!this.graphic) {
        lang.hitch(this, this.addGraphic(pt));
      }else { // move the graphic if it already exists
        this.graphic.setGeometry(pt);
      }
      this.map.centerAt(pt);
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
