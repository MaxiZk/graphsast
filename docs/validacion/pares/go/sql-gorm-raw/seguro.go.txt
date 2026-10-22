package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Producto struct {
	Nombre string
	Precio float64
}

func Buscar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		categoria := c.Query("categoria")
		var productos []Producto
		db.Raw("SELECT * FROM productos WHERE categoria = ?", categoria).Scan(&productos)
		c.JSON(http.StatusOK, productos)
	}
}
