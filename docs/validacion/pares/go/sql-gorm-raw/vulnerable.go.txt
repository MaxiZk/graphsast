package handlers

import (
	"fmt"
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
		db.Raw(fmt.Sprintf("SELECT * FROM productos WHERE categoria = '%s'", categoria)).Scan(&productos)
		c.JSON(http.StatusOK, productos)
	}
}
