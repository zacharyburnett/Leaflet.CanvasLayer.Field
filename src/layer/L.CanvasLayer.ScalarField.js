import Cell from '../Cell';

/**
 * ScalarField on canvas (a 'Raster')
 */
L.CanvasLayer.ScalarField = L.CanvasLayer.Field.extend({
    options: {
        type: 'colormap', // [colormap|vector]
        color: null, // function colorFor(value) [e.g. chromajs.scale],
        interpolate: false, // Change to use interpolation
        vectorSize: null, // only used if 'vector'
        arrowDirection: 'from' // [from|towards]
    },

    initialize: function(scalarField, options) {
        L.CanvasLayer.Field.prototype.initialize.call(
                this,
                scalarField,
                options
        );
        L.Util.setOptions(this, options);
    },

    _defaultColorScale: function() {
        return chroma.scale(['white', 'black']).domain(this._field.range);
    },

    setColor(f) {
        this.options.color = f;
        this.needRedraw();
    },

    /* eslint-disable no-unused-vars */
    onDrawLayer: function(viewInfo) {
        if (!this.isVisible()) return;
        this._updateOpacity();

        let r = this._getRendererMethod();
        // console.time('onDrawLayer');
        r();
        // console.timeEnd('onDrawLayer');
    },
    /* eslint-enable no-unused-vars */

    _getRendererMethod: function() {
        switch (this.options.type) {
            case 'colormap':
                return this._drawImage.bind(this);
            case 'vector':
                return this._drawArrows.bind(this);
            default:
                throw Error(`Unkwown renderer type: ${this.options.type}`);
        }
    },

    _ensureColor: function() {
        if (this.options.color === null) {
            this.setColor(this._defaultColorScale());
        }
    },

    _showCanvas() {
        L.CanvasLayer.Field.prototype._showCanvas.call(this);
        this.needRedraw(); // TODO check spurious redraw (e.g. hide/show
        // without moving map)
    },

    /**
     * Draws the field in an ImageData and applying it with putImageData. Used
     * as a reference:
     * http://geoexamples.com/d3-raster-tools-docs/code_samples/raster-pixels-page.html
     */
    _drawImage: function() {
        this._ensureColor();

        let ctx = this._getDrawingContext();
        let width = this._canvas.width;
        let height = this._canvas.height;

        let img = ctx.createImageData(width, height);
        let data = img.data;

        this._prepareImageIn(data, width, height);
        ctx.putImageData(img, 0, 0);
    },

    /**
     * Prepares the image in data, as array with RGBAs [R1, G1, B1, A1, R2, G2,
     * B2, A2...]
     * 
     * @private
     * @param {[[Type]]}
     *                data [[Description]]
     * @param {Numver}
     *                width
     * @param {Number}
     *                height
     */
    _prepareImageIn(data, width, height) {
        let f = this.options.interpolate ? 'interpolatedValueAt' : 'valueAt';

        let pos = 0;
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                let pointCoords = this._map.containerPointToLatLng([i, j]);
                let lon = pointCoords.lng;
                let lat = pointCoords.lat;

                let v = this._field[f](lon, lat); // 'valueAt' |
                // 'interpolatedValueAt' ||
                // TODO check some
                // 'artifacts'
                if (v !== null) {
                    let color = this._getColorFor(v);
                    let [R, G, B, A] = color.rgba();
                    data[pos] = R;
                    data[pos + 1] = G;
                    data[pos + 2] = B;
                    data[pos + 3] = parseInt(A * 255); // not percent in alpha
                    // but hex 0-255
                }
                pos = pos + 4;
            }
        }
    },

    /**
     * Draws the field as a set of arrows. Direction from 0 to 360 is assumed.
     */
    _drawArrows: function() {
        const bounds = this._pixelBounds();
        const pixelSize = (bounds.max.x - bounds.min.x) / this._field.nCols;

        var stride = Math.max(
                1,
                Math.floor(20 / pixelSize)
        );

        const ctx = this._getDrawingContext();
        ctx.strokeStyle = this.options.color;

        var currentBounds = this._map.getBounds();

        /* draw legend scale */
        /* TODO add color and draw white background and stuff */
        let mapRange = {
            'lat': currentBounds.getEast() - currentBounds.getWest(), 
            'lng': currentBounds.getNorth() - currentBounds.getSouth()
        };

        /* size of scale in percetnage of map canvas */
        let legendSize = 0.05;
        
        let legendOrigin = {
            'lat': currentBounds.getSouthWest()['lat'] + (mapRange['lat'] * legendSize),
            'lng': currentBounds.getSouthWest()['lng'] + (mapRange['lng'] * legendSize)
        };
        
        let legendNorthEast = {
            'lat': legendOrigin['lat'] + (mapRange['lat'] * legendSize),
            'lng': legendOrigin['lng'] + (mapRange['lng'] * legendSize)
        };
        
        for (let direction in {0: null, 270: null}) {
            let cell = new Cell(
                    legendOrigin,
                    direction,
                    this.cellXSize,
                    this.cellYSize
            );
            this._drawArrow(cell, ctx, 1);
        }
        
        /* draw arrows */
        for (var y = 0; y < this._field.height; y = y + stride) {
            for (var x = 0; x < this._field.width; x = x + stride) {
                let [lon, lat] = this._field._lonLatAtIndexes(x, y);
                let direction = this._field.valueAt(lon, lat);
                let magnitude = this.options.vectorSize ? this.options.vectorSize.valueAt(lon, lat) : null;
                
                let center = L.latLng(lat, lon);
                if (direction !== null) {
                    if (currentBounds.contains(center)) {
                        if (!(lon <= legendNorthEast['lng'] && lat <= legendNorthEast['lat'])) {
                            let cell = new Cell(
                                    center,
                                    direction,
                                    this.cellXSize,
                                    this.cellYSize
                            );
                            this._drawArrow(cell, ctx, magnitude);
                        }
                    }
                }
            }
        }
    },

    _pixelBounds: function() {
        const bounds = this.getBounds();
        const northWest = this._map.latLngToContainerPoint(
                bounds.getNorthWest()
        );
        const southEast = this._map.latLngToContainerPoint(
                bounds.getSouthEast()
        );
        var pixelBounds = L.bounds(northWest, southEast);
        return pixelBounds;
    },

    _drawArrow: function(cell, ctx, magnitude) {
        // colormap vs. simple color
        let color = this.options.color;
        if (typeof color === 'function') {
            ctx.strokeStyle = color(cell.value);
        }

        // get current magnitude
        const size = magnitude != null ? magnitude * 50 : 20;

        // save canvas state
        ctx.save();

        var projected = this._map.latLngToContainerPoint(cell.center);
        ctx.translate(projected.x, projected.y);

        // calculate and apply rotation
        let rotationRads = (90 + cell.value) * Math.PI / 180;
        if (this.options.arrowDirection === 'towards') {
            rotationRads = rotationRads + Math.PI;
        }
        ctx.rotate(rotationRads);

        // begin creating arrow
        ctx.beginPath();

        // draw arrow shaft
        ctx.moveTo(-size / 2, 0);
        ctx.lineTo(+size / 2, 0);

        // draw arrow point, somehow
        ctx.moveTo(size * 0.25, -size * 0.25);
        ctx.lineTo(+size / 2, 0);
        ctx.lineTo(size * 0.25, size * 0.25);

        // draw arrow
        ctx.stroke();

        // go back to saved state (reset for next arrow)
        ctx.restore();
    },

    /**
     * Gets a chroma color for a pixel value, according to 'options.color'
     */
    _getColorFor(v) {
        let c = this.options.color; // e.g. for a constant 'red'
        if (typeof c === 'function') {
            c = this.options.color(v);
        }
        let color = chroma(c); // to be more flexible, a chroma color object is
        // always created || TODO improve efficiency
        return color;
    }
});

L.canvasLayer.scalarField = function(scalarField, options) {
    return new L.CanvasLayer.ScalarField(scalarField, options);
};
